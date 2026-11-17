import { readFile, open, type FileHandle } from "node:fs/promises";
import { resolve, join } from "node:path";
import { plotPosition } from "../geo.js";
import type { Plot } from "../types.js";

type SoilValues = [number, number, number, number];

interface SoilManifest {
  dataset?: string;
  depth?: string;
  divisor?: number;
  properties?: string[];
  width?: number;
  height?: number;
  bounds?: number[];
}

interface NearestSoil {
  values: SoilValues;
  pixelX: number;
  pixelY: number;
  distancePixels: number;
}

export interface LocalSoilResult {
  values?: SoilValues;
  missing?: boolean;
  reason?: string;
  dataset?: string;
  depth?: string;
  approximation?: {
    distanceKm: number;
    longitude: number;
    latitude: number;
  };
}

export async function readLocalSoil(
  plot: Plot,
  farm: { latitude: number; longitude: number }
): Promise<LocalSoilResult> {
  const root =
    process.env.SOIL_DATA_DIR ??
    resolve(process.env.APP_ROOT ?? ".", "data/soil/hubei/soil-hubei");
  try {
    const manifest = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8")
    ) as SoilManifest;
    if (
      manifest.divisor !== 10 ||
      manifest.properties?.join(",") !== "phh2o,soc,sand,clay" ||
      !Number.isInteger(manifest.width) ||
      !Number.isInteger(manifest.height) ||
      Number(manifest.width) <= 0 ||
      Number(manifest.height) <= 0 ||
      !Array.isArray(manifest.bounds) ||
      manifest.bounds.length !== 4 ||
      !manifest.bounds.every(Number.isFinite)
    ) {
      return { reason: "本地土壤数据清单无效" };
    }

    const width = Number(manifest.width);
    const height = Number(manifest.height);
    const [west, south, east, north] = manifest.bounds!;
    const point = plotPosition(plot, farm);
    if (
      !Number.isFinite(point.longitude) ||
      !Number.isFinite(point.latitude) ||
      point.longitude < west ||
      point.longitude >= east ||
      point.latitude <= south ||
      point.latitude > north
    ) {
      return { reason: "地块位置超出本地湖北土壤数据覆盖范围" };
    }

    const x = Math.floor(((point.longitude - west) / (east - west)) * width);
    const y = Math.floor(((north - point.latitude) / (north - south)) * height);
    const searchRadius = readSearchRadius();
    const file = await open(join(root, "soil.bin"), "r");
    try {
      if ((await file.stat()).size !== width * height * 8) {
        return { reason: "本地土壤数据文件不完整" };
      }

      const nearest = await findNearestSoil(file, width, height, x, y, searchRadius);
      if (!nearest) {
        return {
          reason:
            searchRadius === 0
              ? "地块所在本地土壤像元无有效数据（可能为水域或其他缺测区域）"
              : `地块所在本地土壤像元无有效数据，且周边 ${searchRadius} 个像元内未找到有效替代像元`
        };
      }

      const center = pixelCenter(nearest.pixelX, nearest.pixelY, manifest.bounds, width, height);
      const approximation =
        nearest.distancePixels > 0
          ? {
              ...center,
              distanceKm: distanceKm(
                point.latitude,
                point.longitude,
                center.latitude,
                center.longitude
              )
            }
          : undefined;

      return {
        values: nearest.values,
        dataset: String(manifest.dataset),
        depth: String(manifest.depth),
        approximation
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { missing: true, reason: "本地土壤数据文件未安装" };
    }
    return { reason: "本地土壤数据读取失败，请检查文件及清单" };
  }
}

function readSearchRadius(): number {
  const configured = Number(process.env.SOIL_LOCAL_SEARCH_RADIUS_PIXELS ?? 8);
  if (!Number.isInteger(configured) || configured < 0) return 8;
  return Math.min(configured, 40);
}

async function findNearestSoil(
  file: FileHandle,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number
): Promise<NearestSoil | null> {
  const minX = Math.max(0, centerX - radius);
  const maxX = Math.min(width - 1, centerX + radius);
  const minY = Math.max(0, centerY - radius);
  const maxY = Math.min(height - 1, centerY + radius);
  const windowHeight = maxY - minY + 1;
  const buffer = Buffer.alloc(width * windowHeight * 8);
  const startOffset = minY * width * 8;
  const { bytesRead } = await file.read(buffer, 0, buffer.length, startOffset);
  if (bytesRead !== buffer.length) return null;

  let nearest: NearestSoil | null = null;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distancePixels = Math.hypot(x - centerX, y - centerY);
      if (nearest && distancePixels >= nearest.distancePixels) continue;
      const offset = ((y - minY) * width + x) * 8;
      const values = decodeSoilValues(buffer, offset);
      if (!values) continue;
      nearest = { values, pixelX: x, pixelY: y, distancePixels };
    }
  }
  return nearest;
}

function decodeSoilValues(buffer: Buffer, offset: number): SoilValues | null {
  const raw = Array.from({ length: 4 }, (_, index) =>
    buffer.readUInt16LE(offset + index * 2)
  );
  if (
    raw.some((value) => value === 65535) ||
    raw[0] <= 0 ||
    raw[0] > 140 ||
    raw[2] > 1000 ||
    raw[3] > 1000
  ) {
    return null;
  }
  return raw.map((value) => value / 10) as SoilValues;
}

function pixelCenter(
  x: number,
  y: number,
  [west, south, east, north]: number[],
  width: number,
  height: number
): { longitude: number; latitude: number } {
  return {
    longitude: west + ((x + 0.5) / width) * (east - west),
    latitude: north - ((y + 0.5) / height) * (north - south)
  };
}

function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA * radians) *
      Math.cos(latitudeB * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
