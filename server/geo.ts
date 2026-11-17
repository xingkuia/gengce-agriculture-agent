export type Coordinate = [number, number]; // longitude, latitude
export interface PlotLocation {
  longitude: number;
  latitude: number;
  coordinateSystem: "GCJ-02" | "WGS84";
  source: "manual" | "map" | "boundary";
  boundary: Coordinate[];
  measuredAreaM2: number | null;
  areaSource: "manual" | "boundary";
}

// Spherical area; local fields must not cross the date line.
export function polygonArea(points: Coordinate[]): number {
  const radians = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += (b[0] - a[0]) * radians * (2 + Math.sin(a[1] * radians) + Math.sin(b[1] * radians));
  }
  return Math.abs(sum * 6371008.8 ** 2 / 2);
}
export function validBoundary(points: Coordinate[]): boolean {
  if (points.length < 3 || points.length > 500 || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return false;
  if (new Set(points.map(p => p.join(","))).size !== points.length) return false;
  const cross = (a: Coordinate,b: Coordinate,c: Coordinate) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) {
    if(j===i+1 || (i===0 && j===points.length-1)) continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
    if(ab1*ab2<=0 && cd1*cd2<=0 && Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0])) && Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))) return false;
  }
  const area=polygonArea(points);
  return area >= 1 && area <= 1e9;
}

export function toGcj([lon,lat]: Coordinate): Coordinate {
  if(lon<72.004 || lon>137.8347 || lat<0.8293 || lat>55.8271) return [lon,lat];
  const x=lon-105,y=lat-35,pi=Math.PI;
  let dlat=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
  dlat+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dlat+=(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dlat+=(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  let dlon=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
  dlon+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dlon+=(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dlon+=(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad=lat*pi/180,magic=1-0.006693421622965943*Math.sin(rad)**2;
  return [lon+dlon*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*pi),lat+dlat*180/(6378245*(1-0.006693421622965943)/(magic*Math.sqrt(magic))*pi)];
}
export function toWgs(point: Coordinate): Coordinate {
  let guess: Coordinate=[...point];
  for(let i=0;i<5;i++){const shifted=toGcj(guess);guess=[guess[0]+point[0]-shifted[0],guess[1]+point[1]-shifted[1]];}
  return guess;
}
export function plotPosition(plot: {location?: PlotLocation | null}, farm: {longitude:number;latitude:number}) {
  const location=plot.location;
  if(!location) return farm;
  const [longitude,latitude]=location.coordinateSystem==='GCJ-02'?toWgs([location.longitude,location.latitude]):[location.longitude,location.latitude];
  return {longitude,latitude};
}
