# 赛道提交说明

## 1. 提交入口

本仓库即赛道提交仓库，主分支包含可运行源码、部署文档、测试和白皮书 PDF。密钥、数据库、构建产物和验收截图不进入版本库。

## 2. 选题与场景

耕策面向小型家庭农场和大型合作社，解决从选种到结果复盘的连续业务问题。场景需求、用户画像和功能映射见 [requirements.md](requirements.md)。

## 3. 可部署性

支持三种运行方式：

1. Windows Electron 桌面应用：`pnpm desktop`
2. 本地浏览器调试：`pnpm dev`
3. Docker Compose：`docker compose up --build`

完整步骤见 [deployment.md](deployment.md)。

## 4. 演示路径

建议演示顺序：

1. 从预置演示账号进入，切换基地与地块。
2. 发起“结合当前地块，这季种什么”任务。
3. 查看多 Agent 轨迹、A2A 产物和独立校验结果。
4. 切换稳收益、低风险、省工和养地目标。
5. 用当地收购价覆盖公开估算。
6. 采用方案，登记农事记录。
7. 提交实际产量、成本和反馈。
8. 展示能力中心中的 MCP、Skills 和知识库。
9. 上传虫害图片，查看候选、依据和补拍建议。

详细脚本见 [demo-script.md](demo-script.md)。

## 5. 技术亮点

- Mastra Agent/Workflow 管理运行生命周期。
- 结构化 A2A 产物，避免专业 Agent 只通过自由文本交接。
- 确定性工具负责数值、季节、轮作和安全规则。
- 独立 Verifier 复核数值、证据覆盖和可执行性。
- 每次运行冻结能力快照，支持刷新与回放。
- MCP 工具按只读、确认和手动三档策略执行。
- SQLite 本地持久化，模型密钥不进入客户端。

架构细节见 [architecture.md](architecture.md)。

## 6. 验证材料

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:ui
pnpm check:desktop
```

最近一次验收记录见 [workflow-acceptance.md](workflow-acceptance.md)。自动化测试通过不代表农业结论已获得实地验证；产品边界在 README 和数据说明中明确列出。

## 7. 申报附件

- [耕策技术白皮书](assets/耕策技术白皮书.pdf)
- [系统架构](architecture.md)
- [选题与场景需求](requirements.md)
- [部署指南](deployment.md)
- [演示流程](demo-script.md)
- [Skills 与能力中心](skills.md)
