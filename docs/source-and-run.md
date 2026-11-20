# 耕策源码与运行说明

## 1 作品与提交信息

| 项目 | 内容 |
| --- | --- |
| 作品名称 | 耕策 |
| 团队名称 | 怀新 |
| 源码仓库 | https://github.com/xingkuia/gengce-agriculture-agent |
| 提交版本 | `4f085e8e778e54d9ab5aadc8725178a74df4e020` |
| 提交形式 | 可运行 Demo 源码仓库，评审可按本文在本机启动 |
| 主要运行形式 | Windows Electron 桌面应用 |

本项目提供地块级种植决策演示，包括环境证据、分目标选种、多 Agent 编排、独立验证，以及种植方案、农事记录、结果复盘与反馈。虫害图片初筛需配置支持图片输入的模型服务。

本次提供源码运行方式，未提供公网在线演示地址。下文的 `localhost` 地址仅用于运行者本机访问。

## 2 环境要求

- Windows 10 或 Windows 11，x64。
- Node.js 24。
- pnpm 11.25.0。
- Git。
- 首次安装依赖需要网络；真实模型调用、在线天气、公开土壤和地图服务也需要相应网络及配置。

## 3 获取源码并启动

在 PowerShell 中依次执行：

```powershell
git clone https://github.com/xingkuia/gengce-agriculture-agent.git
cd gengce-agriculture-agent
git checkout 4f085e8e778e54d9ab5aadc8725178a74df4e020
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm desktop
```

`git checkout` 将代码固定到本次提交版本，便于复现。复制配置文件的命令用于首次运行；已有 `.env` 时请保留原配置。

`pnpm desktop` 会先构建前端及服务端，再打开桌面应用，并自动启动本地业务服务。保持该命令所在终端运行；桌面窗口内即可完成演示操作。

默认配置为 `MODEL_PROVIDER=mock`，用于确定性规则演示。它不等同于真实大模型调用，不能用来验证视觉模型的识别效果。

### 浏览器调试方式

如需在浏览器中查看界面：

```powershell
pnpm dev
```

- 前端地址：http://localhost:5173
- API 健康检查：http://localhost:8787/api/health

桌面端会自动选择本地服务端口，不应假定其端口固定为 8787。浏览器调试与桌面端的数据目录也可能不同。

## 4 真实 AI 功能配置

### DeepSeek 配置

编辑项目根目录 `.env` 中的对应字段：

```dotenv
MODEL_PROVIDER=deepseek
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=请填写自行申请的有效密钥
MODEL_NAME=deepseek-flash
MODEL_SUMMARY_NAME=deepseek-flash
MODEL_VISION_NAME=deepseek-flash
```

本次代码已将 DeepSeek 的默认文本及视觉模型设为 `deepseek-flash`，用于 DeepSeek V4.1 Flash。两个角色共用所配置的接口地址和 API Key；角色专用模型名称可单独覆盖。

### 千问配置

如使用阿里云百炼，可将对应字段替换为：

```dotenv
MODEL_PROVIDER=qwen
MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_API_KEY=请填写自行申请的有效密钥
MODEL_NAME=qwen-plus
MODEL_SUMMARY_NAME=qwen-plus
MODEL_VISION_NAME=qwen3-vl-plus
```

切换提供方时，同时检查并更新 `MODEL_SUMMARY_NAME` 和 `MODEL_VISION_NAME`，避免残留其他平台的模型名称。修改后关闭应用及对应服务，再重新启动。

真实模型功能需要有效密钥、模型访问权限和可用额度，调用可能产生服务费用。源码仓库不包含提交者的私人密钥；规则模式与真实模型模式应在演示中明确区分。

### 地图配置

如需地图选点及地址补全，在 `.env` 中配置自己的高德服务信息：

```dotenv
AMAP_JS_KEY=请填写高德Web端Key
AMAP_SECURITY_CODE=请填写对应安全密钥
```

未配置地图时，可手动填写地块经纬度和面积。天气或土壤服务不可用时，系统可能显示缓存、区域先验或其他降级状态；这些数据不能视为实时观测或实测值。

桌面应用还可能读取 `%APPDATA%\耕策\.env`；从旧版本升级时可能沿用 `%APPDATA%\荆野农策`。若根目录配置与实际显示不一致，请检查用户目录内的配置和外部环境变量。

## 5 建议复现流程

1. 进入桌面应用，选择或创建基地及地块，检查位置、面积和现有作物信息。
2. 提问“结合当前地块的位置、天气和土壤条件，本季种什么更合适？”。
3. 打开“执行轨迹”，查看任务调度、证据和结构化产物。
4. 比较稳健收益、低风险、省工易管、养地轮作等目标下的候选；有本地行情时覆盖公开估算。
5. 查看验证报告。若有真实修复记录，展示问题、修改及再次验证；不是每次任务都会触发修复。
6. 采用适宜候选，打开种植方案和作业清单。
7. 新增一条农事执行记录，保存日期、状态、用量及成本，并重新查看台账。
8. 使用演示数据填写结果复盘与反馈，保存后再次打开，验证记录持久化。模拟收获数据需明确标注，不写入真实生产档案。
9. 配置视觉模型后，上传允许使用的病虫害图片，查看候选、可见依据及补拍建议。图片仅用于初筛，不替代专业确诊。

图片初筛不提供农药品名、剂量或混配处方。上传图片会发送至所配置的模型服务；原图不在本地数据库中保存。

## 6 验证方式与本次验证范围

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:desktop
```

模型配置后，可检查接口连通性：

```powershell
pnpm check:model
```

该连通性检查不代表图片识别准确率验证。

本次模型适配后，类型检查、构建和 26 项自动化测试通过；DeepSeek 文本调用与项目图片识别调用链已完成连通性测试。图片测试使用软件界面截图，模型返回无法判断及补拍建议。尚未据此验证真实田间虫害识别准确率，也不提供增产效果承诺。

## 7 数据与故障排查

桌面模式通常将业务记录保存在 `%APPDATA%\耕策\data\agri.db`；旧版本可能沿用 `%APPDATA%\荆野农策`。浏览器开发模式默认使用项目目录下的 `data/agri.db`。更换代码包不等于删除历史数据，运行与清理前请区分目录。

- 安装失败：检查 Node.js、pnpm 版本及软件包下载网络。
- 没有真实模型回答：检查提供方、接口地址、密钥、模型权限及额度，并确认重启后配置生效。
- 虫害图片调用失败：检查视觉模型名称、图片输入支持及上传图片格式和大小，支持 JPEG、PNG、WebP，最大 4 MB。
- 天气或土壤显示降级：检查网络与数据来源提示；本地土壤栅格未提供时，不应宣称已使用本地栅格证据。
- 数据不一致：确认桌面模式和浏览器模式是否使用同一数据库，以及是否沿用了旧用户目录。

## 8 仓库文档入口

- [源码仓库](https://github.com/xingkuia/gengce-agriculture-agent)
- [固定提交版本](https://github.com/xingkuia/gengce-agriculture-agent/tree/4f085e8e778e54d9ab5aadc8725178a74df4e020)
- [部署指南](https://github.com/xingkuia/gengce-agriculture-agent/blob/main/docs/deployment.md)
- [演示流程](https://github.com/xingkuia/gengce-agriculture-agent/blob/main/docs/demo-script.md)
- [系统架构](https://github.com/xingkuia/gengce-agriculture-agent/blob/main/docs/architecture.md)

模型配置以当前仓库的 `.env.example` 和部署指南为准。高德地图凭据申请、Docker 配置及排查步骤见 [地图配置](deployment.md#4-地图配置)。提交材料前请确认仓库对评审开放访问，并保持所列提交版本可获取。
