# 目标选择交互优化与项目回归（2026-11-17）

## 修改

- 将对话输入栏的原生种植目标下拉框替换为符合现有中性色界面的选择面板。
- 展示目标图标、说明与选中状态，支持单选键盘操作、Escape 返回触发按钮、焦点离开和点击外部关闭。
- 运行期间禁用目标切换；本地行情按钮补充展开状态。
- 修复输入框 overflow 隐藏导致面板被裁切的问题，已检查真实浏览器截图。
- 浏览器验收增加面板展开、目标切换、Escape 和外部点击关闭检查。

## 验证结果

- pnpm typecheck：通过。
- pnpm test：23 项通过，0 失败。
- pnpm build：通过。
- pnpm check:ui：通过，含桌面/窄屏业务流程和 MCP 确认流程，consoleErrors 为空。
- pnpm check:desktop：通过，含 Electron bridge、流式方案与业务流程，consoleErrors 为空。
- pnpm check:model：通过，模型列表及聊天接口均为 HTTP 200，qwen-plus 返回“连接正常”。
- git diff --check：通过。

测试日志和截图位于被 Git 忽略的 test-results/。本轮未验证 Docker 部署、重新打包产物或全部真实外部数据服务；自动化通过不代表所有农业场景已实地验证。
