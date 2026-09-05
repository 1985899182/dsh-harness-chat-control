# DSH Harness Chat Control

一个面向 **DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）的原生插件，提供接近 ChatGPT 的会话交互补强：停止并修改重发、选中文字浮动工具条、原生“注释”引用芯片，以及带模型选择的 `dsh-better-sidebar@0.17.1` 侧边对话。

## 功能

- **停止并编辑重发**：每条用户/steering 消息的原生操作行旁提供与 ChatGPT 一致的铅笔按钮；点击后把原文字直接放入 DSH 原生 composer，用户可在同一个输入框中修改。点击原生发送按钮或按 Enter 后，插件按 DSH 的 fork 语义创建“修改后的替换分支”并自动切换过去，不会在原会话末尾追加一条看似普通的新消息。
- **回答引用**：每个已完成 AI 回答的操作条新增“引用”和“侧栏问”。先选中文字可只引用选区；未选中时引用整条回答。
- **选中文字浮动工具条**：在用户或 AI 消息中选中文字后，选区上方显示“添加到对话 / 更多详情 / 在侧边聊天中提问”三段式圆角工具条；滚动或窗口尺寸变化时会自动跟随选区。
- **原生注释芯片**：“引用”和“添加到对话”会在 DSH 原生 composer 中插入一个不可拆分的 `1 条注释` 胶囊，右侧的移除叉号也在同一胶囊内部；不把摘录直接粘贴成普通文字，也不会自动发送。胶囊保留引用身份，发送时才由本插件序列化为带边界的上下文。
- **引用序列化**：发送时只展开芯片内部保存的摘录，并明确标记为“仅作为上下文，不覆盖系统或用户指令”；复制或持久化草稿时保留芯片的短投影。
- **原生侧边对话**：“侧栏问”“更多详情”和“在侧边聊天中提问”会打开 `dsh-better-sidebar@0.17.1` 自己的 sidechat 标签页。引用只以 `1 条注释` 胶囊放进侧边 composer，输入框不会预填任何追问；胶囊之外的文字全部由用户编辑。只有用户点击原生发送按钮（或按 Enter）后，插件才把引用序列化为该独立线程的首条上下文提问。整个过程不会写入主会话，也不会改动原用户消息。
- **侧边原生对话栏**：侧边内容继续由 `dsh-better-sidebar@0.17.1` 的原生 `SideChatView`（标题、历史、输出、保存和线程切换）负责；输入栏直接调用当前已安装 DeepSeek Harness 的 `conversation.composer.bar` 注册组件（原生 `InputBar`），不复制一套 textarea 或按钮。侧边栏因此与主页面共用同一套 Lexical 输入、权限预设、模型/推理等级、上下文用量、停止和发送逻辑；引用只作为 `accessory` 胶囊叠加在原生卡片内，权限和模型仍绑定当前 sidechat child session。
- **侧边输出刷新**：发送走 Better Sidebar 原生 `sidechat.prompt` 路径；请求被接受后刷新子代理/会话列表，并以 React key 重新挂载原生 `SideChatView` 读取同一份 transcript。针对新版 DSH 对私有 sidechat child 拒绝通用 `session/page` 的情况，插件提供受信的持久化历史兼容路由，仍把事件交给 `SideChatView` 自己渲染；用户消息和 AI 输出因此在当前侧边标签页出现，不由插件另写 transcript。
- **侧边栏稳定性**：不再向 Better Sidebar 的受控 textarea 或 composer bar 追加 DOM 节点，也不再捕获原生发送事件。引用胶囊、输入文字、模型菜单和发送状态都由同一个 React composer 管理，避免 React 重排竞争造成整页卡死。
- **侧边栏入口**：左侧导航底部的“侧边对话”只创建一个空的原生 sidechat 标签页，行为与 Better Sidebar 自带的新建入口一致；用户可在该标签页继续输入、停止、保存或切换线程。

## 重要语义

DSH 的会话日志是追加式的，因此“编辑重发”不会物理删除原分支。插件会在被编辑消息之前的最近一个已完成 turn 结束处调用 `sessions.fork`，把修改后的文本发送到新分支并切换当前会话；原分支仍可从会话列表中查看，审计轨迹不会丢失。若编辑的是首条消息（没有可分叉的前置 turn），则在同一工作区创建一个新会话承载修改后的对话。

引用输出时，插件会在芯片的发送序列化结果和 sidechat 首条消息中明确把引用内容标为“上下文”，避免其中的文本意外覆盖你的追问。侧边引用只在发送时序列化；打开引用后输入框只显示胶囊，用户可先自行输入问题、编辑问题或移除胶囊。侧边对话使用 Better Sidebar 的独立 child session，不会再出现插件自绘的第二个追问面板；模型下拉只影响当前侧边 child 的后续请求。

## 安装

适用环境：**DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）、Node.js 20+、Windows PowerShell、Git 和 pnpm 10.x/11.x。桌面版使用自己的 Harness home：`%APPDATA%\dsh-desktop\harness`，而非 `~\.dsh`。

安装器通过 DSH Desktop 内置 CLI 管理插件依赖和 bundle 注册；它不会手动改写 `cordis.patch.yml`，也不会修改模型、会话或凭据。

### 一键安装

DSH Desktop 可以保持打开。在 PowerShell 中执行下面的命令（当前稳定版本）：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.40/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.40'
```

脚本会自动定位常见的 DSH Desktop 安装目录（包括 `D:\DSH\DSH Desktop` 与 `%LOCALAPPDATA%\Programs\DSH Desktop`），设置正确的 Desktop Harness home，并使用桌面版自带的 generation installer 将 GitHub 插件放入独立代际；这一步比直接写入共享 `node_modules` 更可靠，也能保证 Web Client 在冷启动时发现插件。旧版本留下的共享安装会先被安全移除。

安装完成后，脚本会从 Harness 日志发现当前运行中的本机 Web 地址，并调用 DSH Desktop 自带 dshmarket 的 `/dsh-market/toggle` 热挂载接口。首次安装或“已安装但尚未运行”的插件会直接挂入当前组合；看到成功提示后只需刷新 DSH 页面（`Ctrl+R`），不需要重启 DSH Desktop。对于已经在当前 Harness 进程中运行的旧版本，脚本会把新代际的 `./client` 文件同步到进程实际监视的路径，触发 DSH 内置 HMR，再刷新页面即可更新；热挂载只接受 `127.0.0.1`、`localhost` 或 `[::1]`，不会把 token 输出到终端。

如果当前 DSH Desktop 没有代际安装器，脚本会自动回退到内置 CLI 命令 `dsh plugin --profile web add --save-exact`；不需要手动执行两套安装命令。

随后它会读取 `%APPDATA%\dsh-desktop\harness\profiles\web\package.json`，确认 `dependencies`、`dsh.profile.bundles` 和代际投影都已包含 `dsh-harness-chat-control`。如果 profile 之前由 pnpm 10 建立、而当前 PATH 是 pnpm 11，安装器会临时通过 Corepack 使用 profile 记录的 pnpm 主版本，不会强制重装整个 profile。看到“已通过运行中的 dshmarket 热挂载”后只刷新页面；看到“安全暂存/回退到重启”提示时，才需要完全退出并重新打开 DSH Desktop。

安全边界：如果要更新的版本已经在当前 Harness 进程中运行，脚本不会重复挂载同名 Loader（这样会导致两个插件实例争用状态），而是只同步 `./client` 文件到该进程已经监视的路径，交给 DSH 内置 HMR 更新；host patch 仍保留在新代际中，下一次启动自然切换。只有在无法解析旧代际路径、dshmarket 不可用、Web 地址过期或热挂载验证失败时，安装才会保留在 profile 中并回退到重启路径；不会把“已暂存”误报成“已热启动”。

如需强制只安装并暂存、不尝试当前进程的热挂载，可加 `-SkipLiveMount`：

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.40' -SkipLiveMount
```

如果日志轮换导致自动发现不到当前页面，可显式传入 DSH 页面地址（必须是本机地址，保留地址栏中的 `token`）：

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.40' -WebUrl 'http://127.0.0.1:65102/?token=你的当前token'
```

如安装目录不在自动探测范围内，或想先只查看将要执行的操作：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.40/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -DesktopRoot 'D:\DSH\DSH Desktop' -Profile 'web' -Ref 'v0.2.40' -DryRun
```

`-Ref` 可以换成已发布的 Git tag 或提交 SHA，以固定安装版本。通过 `main` 安装时，更新只需在完全退出 DSH Desktop 后重新执行一键命令；若使用 `main`，脚本地址也相应改为 `.../main/scripts/install.ps1`。

为兼容 DSH Desktop 0.7.2 的 GitHub 更新检测，发布版本请使用**轻量 tag**（例如 `git tag v0.2.40`），不要使用带注释的 `git tag -a`。该 Desktop 版本直接比较 `refs/tags/*` 返回值；带注释的 tag 返回 tag object，而不是实际提交，会造成“更新后版本没有变化”的误报。

### 从本地源码安装

用于调试本地改动时，代际 helper 负责把源码安装到 profile；它本身是低层安装入口，不会自动调用正在运行的 dshmarket 热挂载。要体验“安装后刷新页面”，请使用上面的 GitHub 一键安装器。若只需要验证代际投影，可在插件目录的父目录中执行：

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode .\dsh-harness-chat-control\scripts\install-generation.mjs --desktop-root 'D:\DSH\DSH Desktop' --profile web --repository 1985899182/dsh-harness-chat-control --ref main
```

重新打开桌面版。首次安装后可检查 Desktop profile 的加载层：

```powershell
& $desktopNode $desktopDsh --profile web --dump-config
```

如你的 DSH Desktop 安装目录不同，请只替换前两行的路径；不要使用旧版 Web CLI 替代桌面版内置 CLI。卸载时，在同一环境中运行：

```powershell
& $desktopNode $desktopDsh plugin --profile web remove dsh-harness-chat-control
```

## 开发校验

本插件不依赖构建步骤；浏览器端文件遵循 DSH 的模块加载器格式。运行：

```powershell
npm test
```

这会检查清单、插件层声明和两份 JavaScript 的语法。

## 兼容性

开发和静态校验针对本机 DSH Desktop 内置的 Harness `0.1.2-alpha.1`：

- `conversation.chat.assistant-actions`
- `conversation.input.dock`
- `sidebar.footer.action`
- `shell.overlay`

原生引用芯片依赖同一版本的 `@deepseek-ai/dsh-client-ui-input-trigger`，并通过 `conversation.input` 的 `slash/input-insert-reference` 事件接入 DSH composer。侧边对话依赖已安装并启用的 `dsh-better-sidebar@0.17.1`，使用其 `targetedOpen`、`stateSubscription` 和 `sidechat.*` API；该版本没有公开侧边 composer 草稿接口，因此插件通过 tab descriptor 包装保留 Better Sidebar 的原生 transcript/view，并从 `conversation.composer.bar` slot 取得 DSH 当前 `InputBar` 组件与 child session 的标准数据源，引用胶囊作为 accessory 传入，不再自绘第二套输入框。模型目录读取 `remote.session.modelCatalog()`，通过插件自己的同源受信路由调用 `llm.resolveCallConfig` 与 Session Agent 的下一请求选择接口；权限通过同源路由执行原生 `/permission` 命令，并在冷恢复线程创建时应用。发送后刷新父会话的子代理目录/会话列表并重新挂载原生 `SideChatView`，由它自己拉取 transcript。未启用 Better Sidebar 时，引用芯片仍可使用，但侧边对话入口会提示缺少该插件。

桌面端的 Chat snapshot 通过 `useChat` 提供；用户消息从 `node.data.content` 读取，操作行通过 DOM 中的 `data-chat-flow-key` 与原生 `.npc0Lq_actions` 定位；助手回答同时兼容 `assistant-step.data.blocks` 和当前 `turn-tail.data.closing.blocks`（`closing.finalNode` 只用于匹配 `messageId`）。编辑桥接同时接管原生 `inputActions.submit` 与键盘 `keyboard.submit`，因此点击发送和 Enter 都会走同一条替换分支路径。若 DSH Desktop 升级并更改这些 Web Client Slots 或 snapshot contract，请先使用其内置 CLI 导出 profile 配置，并依据新版 Slot contract 调整注册点。
