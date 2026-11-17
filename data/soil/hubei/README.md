# 湖北土壤背景栅格

数据源：ISRIC SoilGrids 2.0，通过官方 WCS GetCoverage 取得。

- 指标：水浸提 pH (`phh2o`)、土壤有机碳 (`soc`)、砂粒 (`sand`)、黏粒 (`clay`)。
- 深度：0–5 cm；统计值：mean。
- 范围：WGS84 经度 108.3–116.2°、纬度 29.0–33.3°，覆盖湖北的矩形，包含相邻省份部分区域。**没有使用湖北行政边界做掩膜**。
- 输出：EPSG:4326 GeoTIFF。源数据为 250 米格网；WCS 重投影后的实际像元大小见 `manifest.json`，不能理解为田块级实测。
- 四个栅格均保留原始整数值。使用时除以 10，依次得到 pH、g/kg 有机碳、% 砂粒和 % 黏粒。有机碳不是有机质。
- `validity-mask.bin` 与四图层对齐，按行存储，每像元 1 字节；1 表示可用、0 表示不可用。pH 原值为 0、超范围或被标记 NoData 的位置被排除。不能将空值填成 0 后用于农业计算。
- `manifest.json` 包含下载地址、时间、大小、SHA-256、坐标范围、有效像元数、单位换算和抽样值。`status=complete` 才表示四图层均已完成验证。

重新下载或验证：在项目根目录运行 `node scripts/download-hubei-soil.mjs`。已有文件会直接读取、校验并复用；脚本不访问或修改农场数据库。

获取方式：pH 由一次 WCS 请求取得；其余三个图层将覆盖范围分成 4×4 个小块，按 pH 格网指定输出尺寸，校验地理范围后拼接，避免省级整幅请求超时。WCS 请求地址见清单，分块参数计算见 `scripts/soil-tiles.mjs`。下载期间的 `.download-cache` 用于断点恢复，不参与应用查询；本次校验完成后已清理中间分块。

授权：CC BY 4.0。使用或再分发时保留来源与授权信息，并注明区域裁剪、重投影和有效性筛选。

- 来源与获取说明：https://docs.isric.org/globaldata/soilgrids/wcs.html
- 图层与单位：https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html
- 授权说明：https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html
- 归属：ISRIC — World Soil Information / SoilGrids 2.0。

这些文件是土壤背景预测数据，不是近期测土报告，也不能反映一次施肥或灌溉后的即时变化。现已接入本地查询：用户测土值优先，其次查询本地格网；覆盖范围外或无有效像元时返回明确标注的区域先验。`soil-hubei/` 是桌面应用使用的轻量随机读取格式，由 `pnpm soil:prepare` 从已校验 TIFF 生成，随桌面包一同分发。

本次结果：四个 GeoTIFF 约 38.32 MiB，有效像元掩膜约 6.00 MiB，共约 44.32 MiB。`sample-points.csv` 提供若干参考坐标的换算结果，空单元格表示无可用数据，不能当作零值。

仓库已包含上述四个 GeoTIFF、有效性掩膜和 soil-hubei/soil.bin，总计约 92.29 MiB；克隆后即可读取本地土壤数据，无需另外下载。pnpm soil:prepare 会校验原始栅格并重新生成应用读取格式。数据测试仍使用独立的小型合成样本，避免将测试的可重复性与完整数据集绑定。
