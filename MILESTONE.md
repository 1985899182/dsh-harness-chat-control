# v0.2.60 — DSH Desktop 0.7.2 安装与网络兼容里程碑

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
- 安装器使用 DSH Desktop 代际 profile；已运行插件升级可通过客户端同步和页面刷新生效，首次代际安装则明确要求完全重启桌面程序。
- 清理旧的手写侧边 textarea、重复 draft/controller、发送拦截器和权限路由，只保留原生组件与必要的宿主路由。
- 针对 DSH alpha.1 与 Better Sidebar 0.18.x 的 `connection.state.getSnapshot` 崩溃增加兼容桥，并在文档/安装流程中固定 `dsh-better-sidebar@0.17.1`。
- 代际安装统一使用显式 `git+https://github.com/...` 源，避免 pnpm 将 `github:` 简写解析为 SSH 并触发 `Host key verification failed`。
- 安装器自动读取进程环境/WinINET 代理，把代理传给 pnpm、git、node，并支持 `-Proxy`、`-Registry` 和可调 `-FetchRetries`。
- 首次代际安装或未 live 插件不再盲目调用热挂载接口；直接提示冷启动重投影。只有已 live 插件升级才走客户端同步和 HMR。
- dshmarket 热挂载失败时保留经过脱敏的 HTTP 状态和响应体，便于区分 502、代理不可用和 profile 状态问题。

## 更新边界

这个里程碑只对上述版本组合提供验证结论。若 DSH Desktop、内置 Harness 或 Better Sidebar 升级到其他主/次版本，应先检查对应的 Slot、session snapshot 和 sidechat contract，再决定是否继续使用本版本。
