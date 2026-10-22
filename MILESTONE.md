# v0.3.5 — Harness 0.2.1-rc.2 适配里程碑

状态：**稳定基线 / Milestone**

## 适配范围

- DSH Desktop：`0.12.1`（Windows）
- 内置 DeepSeek Harness：`0.2.1-rc.2`
- `dsh-better-sidebar`：`0.28.0`
- Node.js：`>=20`
- pnpm：`10.x`（桌面版 profile 首选；`11.x` 可用）

## 已验证能力

- 右侧栏标签的右键菜单在宿主原生“关闭”项下方新增“关闭其他标签 / 关闭右侧标签 / 关闭左侧标签”，通过 `sidebar.right.tab.menu.item` 插槽注册；已在 DSH Desktop `0.12.1` 实测三种批量关闭，左右顺序与标签栏一致，无可关闭目标时对应项置灰。
- 在主对话连续选中不同文本并选择“在侧边聊天中提问”时，侧边栏为每次引用创建独立的侧边对话标签；未关闭已有标签也能继续新增，各标签保留各自的引用注释、模型选择和输入草稿。已在 DSH Desktop `0.12.1` 实测连续引用产生独立标签。
- 主对话用户消息编辑后，在原位置覆盖显示新消息和新回答，不在旧回答下追加重复分支。
- 普通刷新和 DSH 内置 HMR 后仍保持同一套原生 ChatView 投影。
- 引用以原生注释胶囊进入主对话和侧边对话，发送前可编辑，正文不被 Markdown 符号污染。
- 侧边对话直接内置 `dsh-better-sidebar@0.24.1` 的 SideChatView、转录映射和样式，并由本项目独占 `sidechat.*` 宿主 API；即使外部安装其他版本，也不会覆盖本项目实现。
- 安装器使用 DSH Desktop 代际 profile；已运行插件升级可通过客户端同步和页面刷新生效，首次代际安装则明确要求完全重启桌面程序。
- 侧边引用草稿只通过独立外部 store 传给内置视图，发送前不会自动提交，也不会修改主对话；旧的 DOM 注入/事件拦截路径不再挂载。
- 适配 Harness 0.2.0-rc.2 与 Better Sidebar 0.24.1：侧边对话内嵌视图的图标与 Markdown 代码卡标签对齐新的 dsh-client-ui-primitives 契约，宿主会话/预设/子代理与图片准入 API 保持兼容。
- 代际安装统一使用显式 `git+https://github.com/...` 源，避免 pnpm 将 `github:` 简写解析为 SSH 并触发 `Host key verification failed`。
- 安装器自动读取进程环境/WinINET 代理，把代理传给 pnpm、git、node，并支持 `-Proxy`、`-Registry` 和可调 `-FetchRetries`。
- 首次代际安装或未 live 插件不再盲目调用热挂载接口；直接提示冷启动重投影。只有已 live 插件升级才走客户端同步和 HMR。
- dshmarket 热挂载失败时保留经过脱敏的 HTTP 状态和响应体，便于区分 502、代理不可用和 profile 状态问题。
- 修复隔离模块加载路径下用户消息缺少稳定 `id` 导致的 `message "undefined" is already pending`；主对话和侧边对话注入/提问现在始终生成唯一消息标识。
- 侧边栏模型选择继续使用 DSH 原生 `conversation.input.model`，选择结果写入侧边子会话的 `selectForNextRequest`，不再只改变显示文字。
- 侧边栏输入栏继续使用 DSH 原生 `conversation.composer.bar` / `InputBar`；图片沿用 `imageIds → serializeDraftImages → admitEncodedImages`，以 durable image block 进入侧边消息，视觉模型可以实际读取附件。
- 侧边对话在宿主重启后可直接使用：面板打开即渲染 `dshhc-sidechat-native-view` 与 `dshhc-sidechat-native-composer`，不再出现“正在准备侧边对话输入框…”占位状态。
- 侧边对话可完成端到端问答：提交后子会话日志写入 `user/message`（boundary 注入，`source.kind = plugin:dsh-harness-chat-control`）、携带引用的用户消息、`assistant/message` 与 `turn/end {"reason":{"kind":"completed"}}`，界面同步渲染用户气泡、注入上下文行与助手回答。
- 「添加到对话」与「在侧边聊天中提问」两个入口都能把选区转换成原生注释胶囊（`data-composer-chip="dsh-harness-chat-control"`，`title="1 条注释"`）；侧边入口还会把引用写进子会话作用域保留快照 `retainedBy: {"dsh-harness-chat-control:sidechat": 1}`。
- 侧边对话「对话 / 轨迹」标签往返切换复用同一子会话，composer 始终可用；连续 3 次往返后作用域保留计数稳定为 1，未出现引用计数累积或泄漏。
- 暂停/停止后编辑用户消息不再报错：写入的位置替换事件使用宿主唯一接受的精确形状，日志中出现 `{ op: 'replace', startSeq, endSeq }`，不再产生 `session event "user/message" carries an invalid replace surfaceOp`。

## 本版新增：Harness 0.2.1-rc.2 适配

宿主升级到 `0.2.1-rc.2` 后移除了 `webRuntime` 服务，并把准入判断收敛到连接服务，插件因此有两处必须同步：

1. **移除 `webRuntime` 注入**：`cordis.patch.yml`、安装器写入的 profile patch 层与 bundle patch 三处都不再声明 `webRuntime`。旧声明会让启动审计直接失败（`startup failed: 2 required plugins did not activate`），插件整体不激活。
2. **准入改用 `connection.requestRejection(req)`**：`lib/index.js` 的 `trustedRequest()` 先调用连接服务，返回 `undefined` 视为通过、`401/403` 视为拒绝；宿主未提供该服务时才回退到原来的 Host/Origin 校验。

同版还给模型座位新增了 `renderSlot` 契约：`ModelSelect` 会调用 `renderSlot("conversation.input.model.label", { provider, model, placement, selected }, { fallback: model.name })`，缺省该 prop 会抛 `renderSlot is not a function`。侧边对话的 `NativeSidechatComposer` 现在自建一个透传渲染器：`model.label` 直接返回 `fallback`（模型名），`model` / `plan` / `attachments` 三个座位则把同一个渲染器继续传下去，因此宿主 `InputBar` 在侧边对话里与主对话使用完全相同的座位实现。

`dsh-better-sidebar` 同步升级到 `0.28.0`：`openTab(seed, scope)` 与 `features: ['targetedOpen','stateSubscription']` 保持兼容，`sidebarRightTabs.get('sidechat').multiple` 仍是宿主支持的多实例开关，右键批量关闭所用的 `sidebar.right.tab.menu.item` 与 `closeIn` 也未变化。

桌面端会用批量 `??` 资源地址和包自身的单资源地址各执行一次同一份客户端 bundle，第二次注册私有 `dsh-harness-chat-control-sidechat` 模块时 `client-modules` 会抛 `duplicate factory registration`。两次注册内容相同，第一次注册仍然生效，因此 bundle 现在统一经由 `loadBundle()` 注册，只忽略这一类重复注册，其他加载错误照旧抛出，控制台不再出现该未捕获异常。

## 本版新增：侧边栏标签批量关闭

宿主把右侧栏标签的右键菜单开放为 `sidebar.right.tab.menu.item` 列表插槽：它自己先渲染“关闭”，再渲染插件注册的条目。本插件注册三个条目——关闭其他标签、关闭右侧标签、关闭左侧标签——顺序取当前标签栏 `data-dockkit-strip` 内 `data-dockkit-tab` 的 DOM 顺序（即用户看到的左右），关闭统一调用 `ctx.get('sidebarRight').closeIn(sessionId, tabId)`，与宿主自己的关闭按钮走同一条通道，保留关闭前清理和唯一 guide 页保护。左右没有可关闭目标时对应条目自动置灰。菜单项尺寸、字号、圆角与悬停底色对齐宿主原生条目。

## 历史修复（v0.3.3）：侧边对话只能打开一个标签

Better Sidebar 把 `sidechat` 作为普通页面类型注册到宿主 `sidebarRightTabs`，没有声明多实例。宿主 `placeTab()` 对单实例类型始终使用 `pageAddress(kind)` 作为 contentId，第二次及以后的打开会被 `findContentTab()` 判定为“该页面已打开”，于是只聚焦第一个标签；只有关闭标签释放 contentId 后才能再次创建。现在插件在 `install()` 时和每次 `openNativeSideChat()` 之前，通过 `ctx.get('sidebarRightTabs').get('sidechat')` 取出当前有效的注册定义并把 `multiple` 置为 `true`——与内置终端、浏览器标签完全相同宿主开关。此后每次打开都会得到带独立 UUID 的 contentId，`revealIfOpened` 不再命中旧标签，引用若干名词即并列若干侧边对话。

## 历史修复（v0.3.2）

1. **侧边子会话作用域未实体化**：Better Sidebar 的 sidechat 子会话是私有子代理会话，在视图请求前不会创建对应 session scope，因此 `sessions.binding(childId)` 为 `undefined`，原生 `InputBar` 的所有数据源都解析失败，输入框永久停留在占位状态。现在由 `retainSidechatScope` 走宿主同款 `sessions.retain(id, { source })` 接缝实体化作用域并按引用计数保活；子会话异步创建导致的首次失败会退化为直接 `materializeScope` 后重试，成功后通过 `scopeRevision` 触发重新解析。
2. **会话格式 V4 拒绝已废弃的 source 包装**：边界注入消息曾写成 `{ kind: 'plugin', plugin }` 包装，`assertV4MessageSources` 会抛出 `format v4 message requires a producer-owned source kind`，导致整次准入被中止、子会话日志只留 header。现在直接写入 producer 自有的 `kind: 'plugin:dsh-harness-chat-control'`。
3. **消息编辑的位置替换标记形状不合法**：宿主 `dsh-session` 的 `isReplaceOp` 只接受恰好三个键 `{ op, startSeq, endSeq }`，本插件曾按旧形状写出 `{ op: 'replace', start, end }`，字段名不匹配使 `surfaceOpOf` 抛 `carries an invalid replace surfaceOp`，整条 `user/message` 准入被中止。现在写入端改用 `startSeq`/`endSeq`，读取端（作用域折叠、替换溯源、客户端改写信息回放）同步改为读取新字段名。

> 注意：宿主端 `lib/index.js` 在进程启动时加载，`install-generation.mjs` 的客户端同步只热更新浏览器产物，因此涉及宿主侧修复的版本必须完全重启 DSH Desktop 才会生效。

## 更新边界

这个里程碑只对上述版本组合提供验证结论。若 DSH Desktop、内置 Harness 或 Better Sidebar 升级到其他主/次版本，应先检查对应的 Slot、session snapshot 和 sidechat contract，再决定是否继续使用本版本。
