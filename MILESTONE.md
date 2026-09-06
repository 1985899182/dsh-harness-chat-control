# v0.2.59 — DSH Desktop 0.7.2 兼容里程碑

状态：**稳定基线 / Milestone**

## 适配范围

- DSH Desktop：`0.7.2`（Windows）
- 内置 DeepSeek Harness：`0.1.2-alpha.1`
- `dsh-better-sidebar`：`0.17.1`
- Node.js：`>=20`
- pnpm：`10.x`（桌面版 profile 首选；`11.x` 可用）

## 已验证能力

- 主对话用户消息编辑后，在原位置覆盖显示新消息和新回答，不在旧回答下追加重复分支。
- 普通刷新和 DSH 内置 HMR 后仍保持同一套原生 ChatView 投影。
- 引用以原生注释胶囊进入主对话和侧边对话，发送前可编辑，正文不被 Markdown 符号污染。
- 侧边对话沿用 `dsh-better-sidebar@0.17.1` 与 DSH 原生 `InputBar`、模型、权限和发送流程。
- 安装器使用 DSH Desktop 代际 profile，并在页面刷新后生效；不需要重启桌面程序即可更新 Web Client。
- 清理旧的手写侧边 textarea、重复 draft/controller、发送拦截器和权限路由，只保留原生组件与必要的宿主路由。
- 针对 DSH alpha.1 与 Better Sidebar 0.18.x 的 `connection.state.getSnapshot` 崩溃增加兼容桥，并在文档/安装流程中固定 `dsh-better-sidebar@0.17.1`。

## 更新边界

这个里程碑只对上述版本组合提供验证结论。若 DSH Desktop、内置 Harness 或 Better Sidebar 升级到其他主/次版本，应先检查对应的 Slot、session snapshot 和 sidechat contract，再决定是否继续使用本版本。
