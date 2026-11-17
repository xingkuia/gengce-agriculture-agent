# 部署指南

## 1. 环境要求

通用要求：

- Node.js 24
- pnpm 11.25.0
- Git

桌面打包额外要求：

- Windows 10/11 x64
- 可用的 Electron 构建环境

Docker 部署额外要求：

- Docker Desktop 或兼容的 Docker Engine
- Docker Compose v2

## 2. 本地开发

安装依赖并创建本地配置：

```powershell
pnpm install
Copy-Item .env.example .env
```

启动桌面应用：

```powershell
pnpm desktop
```

启动浏览器调试环境：

```powershell
pnpm dev
```

浏览器调试地址：

- 前端：`http://localhost:5173`
- API：`http://localhost:8787`

桌面端是主交付形式。浏览器模式用于开发和自动化验收。

## 3. 模型配置

未配置密钥时，`MODEL_PROVIDER=mock` 会启用确定性演示模式。

DeepSeek 示例：

```dotenv
MODEL_PROVIDER=deepseek
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-server-side-key
MODEL_NAME=deepseek-chat
```

千问示例：

```dotenv
MODEL_PROVIDER=qwen
MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_API_KEY=your-server-side-key
MODEL_NAME=qwen3-max
MODEL_SUMMARY_NAME=qwen3-max
MODEL_VISION_NAME=qwen3-vl-plus
```

可选配置：

- `DASHSCOPE_API_KEY`：`MODEL_API_KEY` 未设置时作为别名使用。
- `MODEL_SUMMARY_NAME`：证据摘要与文本表达模型。
- `MODEL_VISION_NAME`：虫害图片观察模型。
- `OPEN_METEO_TIMEOUT_MS`：天气接口超时，默认 `6000`。
- `SOILGRIDS_TIMEOUT_MS`：土壤接口超时，默认 `4500`。

所有密钥只允许保存在服务端环境变量中。

## 4. 地图配置

地块边界绘制和地址补全使用高德 Web JS API：

```dotenv
AMAP_JS_KEY=your-web-js-key
AMAP_SECURITY_CODE=your-security-code
```

安全密钥由本地 API 代理附加，不直接返回页面。未配置时仍可手动填写坐标和面积。

### 演示环境中的密钥注入

本机演示时，将以下变量写入项目根目录 `.env`：

```dotenv
AMAP_JS_KEY=your-web-js-key
AMAP_SECURITY_CODE=your-security-code
```

使用 Docker Compose 时，Compose 会自动从根目录 `.env` 读取这两个变量并传入容器，无需修改 `docker-compose.yml`。

在 GitHub 仓库中只保留 `.env.example`。如果使用 GitHub Actions 或云主机部署，请把 `AMAP_JS_KEY` 和 `AMAP_SECURITY_CODE` 配置为对应平台的 Secrets/Environment Variables，再由启动命令注入运行时。不要把真实安全密钥提交到 `main`、README、截图或发布包。

建议为演示单独创建高德应用 Key，并按实际访问域名或本机端口配置白名单；比赛结束后可单独吊销该 Key。

## 5. Docker 部署

```powershell
Copy-Item .env.example .env
docker compose up --build
```

访问 `http://localhost:8787`。

查看运行状态：

```powershell
docker compose ps
```

查看日志：

```powershell
docker compose logs -f agriculture-agent
```

停止服务：

```powershell
docker compose down
```

数据库保存在具名卷 `agriculture-data`。仅停止容器不会删除业务数据；执行 `docker compose down -v` 会同时删除数据卷。

## 6. 桌面打包

构建并生成 Windows x64 目录：

```powershell
pnpm desktop:package
```

产物位置：

```text
release/Gengce-win32-x64/Gengce.exe
```

桌面包会将本地 Agent 服务一并打包，用户无需单独启动 Node 进程。首次运行时，应用会读取项目 `.env` 或将配置放在用户数据目录：

```text
%APPDATA%\耕策\.env
```

## 7. 数据持久化

- 开发模式默认数据库：`data/agri.db`
- 桌面模式默认数据库：`%APPDATA%\耕策\data\agri.db`
- Docker 模式默认数据库：容器内 `/data/agri.db`

数据库文件、运行时日志和测试产物均已加入 `.gitignore`，不会随仓库提交。

## 8. 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:ui
pnpm check:desktop
```

模型接口连通性检查：

```powershell
pnpm check:model
```

该命令会读取 `.env` 并向模型服务发起 OpenAI 兼容请求，请确认当前网络和密钥可用。

## 9. 常见问题

### 页面可以打开但没有模型回答

确认 `.env` 中 `MODEL_PROVIDER`、`MODEL_BASE_URL`、`MODEL_API_KEY` 和 `MODEL_NAME` 已配置。未配置时系统会回退到确定性模式，回答能力仍可演示。

### 天气或土壤显示降级

外部公共接口可能超时。系统会标记缓存或区域先验，不会把降级数据显示为实测值。可稍后刷新地块上下文。

### 桌面数据库与浏览器数据库不同

这是预期的数据隔离。桌面端使用 Electron 用户数据目录，开发浏览器使用项目 `data/agri.db`。

### 地图无法使用

检查高德 Web JS Key、安全密钥和域名/应用配置。地图不可用时仍可手动填写经纬度和面积。
