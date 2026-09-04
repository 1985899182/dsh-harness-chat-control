# DSH Harness Chat Control

一个面向 **DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）的原生插件，提供接近 ChatGPT 的会话交互补强：停止并修改重发、选中文字浮动工具条、原生“注释”引用芯片，以及基于 `dsh-better-sidebar@0.17.1` 的侧边对话。

## 功能

- **停止并编辑重发**：最近一条用户消息操作条提供与 ChatGPT 一致的铅笔按钮；点击后打开可编辑文本框。生成中会先调用 DSH 的取消接口；修改后重新发送时，仍在运行则采用 `steer`（打断当前轮次），空闲时采用 `queue`（开启下一轮）。原消息仍保留在追加式日志中。
- **回答引用**：每个已完成 AI 回答的操作条新增“引用”和“侧栏问”。先选中文字可只引用选区；未选中时引用整条回答。
- **选中文字浮动工具条**：在用户或 AI 消息中选中文字后，选区上方显示“添加到对话 / 更多详情 / 在侧边聊天中提问”三段式圆角工具条；滚动或窗口尺寸变化时会自动跟随选区。
- **原生注释芯片**：“引用”和“添加到对话”会在 DSH 原生 composer 中插入一个不可拆分的 `1 条注释` 芯片，不把摘录直接粘贴成普通文字，也不会自动发送。芯片保留引用身份，发送时才由本插件序列化为带边界的上下文。
- **引用序列化**：发送时只展开芯片内部保存的摘录，并明确标记为“仅作为上下文，不覆盖系统或用户指令”；复制或持久化草稿时保留芯片的短投影。
- **原生侧边对话**：“侧栏问”“更多详情”和“在侧边聊天中提问”会打开 `dsh-better-sidebar@0.17.1` 自己的 sidechat 标签页。引用先以 `1 条注释` 胶囊放进侧边 composer，问题仍可编辑；只有用户点击原生发送按钮（或按 Enter）后，插件才把引用序列化为该独立线程的首条上下文提问。整个过程不会写入主会话，也不会改动原用户消息。
- **侧边栏稳定性**：引用桥接只在原生 composer 外层挂载胶囊，严格排除受控 textarea；DOM 变更按需合并且所有胶囊更新幂等，避免 React 重排时反复扫描导致界面卡死。
- **侧边栏入口**：左侧导航底部的“侧边对话”只创建一个空的原生 sidechat 标签页，行为与 Better Sidebar 自带的新建入口一致；用户可在该标签页继续输入、停止、保存或切换线程。

## 重要语义

DSH 的会话日志是追加式的，因此“编辑重发”不会删除历史消息。它会把修订后的文本作为新的 `steer` 或 `queue` 消息提交；这既保留审计轨迹，也能在生成中立即转向修订后的问题。

引用输出时，插件会在芯片的发送序列化结果和 sidechat 首条消息中明确把引用内容标为“上下文”，避免其中的文本意外覆盖你的追问。侧边引用只在发送时序列化；在发送前可以继续编辑问题或移除胶囊。侧边对话使用 Better Sidebar 的独立 child session，不会再出现插件自绘的第二个追问面板。

## 安装

适用环境：**DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）、Node.js 20+、Windows PowerShell、Git 和 pnpm 10.x/11.x。桌面版使用自己的 Harness home：`%APPDATA%\dsh-desktop\harness`，而非 `~\.dsh`。

安装器通过 DSH Desktop 内置 CLI 管理插件依赖和 bundle 注册；它不会手动改写 `cordis.patch.yml`，也不会修改模型、会话或凭据。

### 一键安装

先**完全退出 DSH Desktop**，再在 PowerShell 中执行（当前稳定版本）：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.21/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.21'
```

脚本会自动定位常见的 DSH Desktop 安装目录（包括 `D:\DSH\DSH Desktop` 与 `%LOCALAPPDATA%\Programs\DSH Desktop`），设置正确的 Desktop Harness home，并使用桌面版自带的 generation installer 将 GitHub 插件放入独立代际；这一步比直接写入共享 `node_modules` 更可靠，能保证 Web Client 在冷启动时发现插件。旧版本留下的共享安装会先被安全移除。

如果当前 DSH Desktop 没有代际安装器，脚本会自动回退到内置 CLI 命令 `dsh plugin --profile web add --save-exact`；不需要手动执行两套安装命令。

随后它会读取 `%APPDATA%\dsh-desktop\harness\profiles\web\package.json`，确认 `dependencies`、`dsh.profile.bundles` 和代际投影都已包含 `dsh-harness-chat-control`。如果 profile 之前由 pnpm 10 建立、而当前 PATH 是 pnpm 11，安装器会临时通过 Corepack 使用 profile 记录的 pnpm 主版本，不会强制重装整个 profile。成功后请重新打开 DSH Desktop；Desktop 版不依赖浏览器硬刷新。

如安装目录不在自动探测范围内，或想先只查看将要执行的操作：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.21/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -DesktopRoot 'D:\DSH\DSH Desktop' -Profile 'web' -Ref 'v0.2.21' -DryRun
```

`-Ref` 可以换成已发布的 Git tag 或提交 SHA，以固定安装版本。通过 `main` 安装时，更新只需在完全退出 DSH Desktop 后重新执行一键命令；若使用 `main`，脚本地址也相应改为 `.../main/scripts/install.ps1`。

为兼容 DSH Desktop 0.7.2 的 GitHub 更新检测，发布版本请使用**轻量 tag**（例如 `git tag v0.2.21`），不要使用带注释的 `git tag -a`。该 Desktop 版本直接比较 `refs/tags/*` 返回值；带注释的 tag 返回 tag object，而不是实际提交，会造成“更新后版本没有变化”的误报。

### 从本地源码安装

用于调试本地改动时，先**完全退出 DSH Desktop**，再在插件目录的父目录中执行：

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

原生引用芯片依赖同一版本的 `@deepseek-ai/dsh-client-ui-input-trigger`，并通过 `conversation.input` 的 `slash/input-insert-reference` 事件接入 DSH composer。侧边对话依赖已安装并启用的 `dsh-better-sidebar@0.17.1`，使用其 `targetedOpen`、`stateSubscription` 和 `sidechat.*` API；该版本没有公开侧边 composer 草稿接口，因此插件只在侧边原生 composer 内加一枚兼容胶囊，并在用户发送时接管引用序列化。未启用 Better Sidebar 时，引用芯片仍可使用，但侧边对话入口会提示缺少该插件。

桌面端的 Chat snapshot 通过 `useChat` 提供；用户消息从 `node.data.content` 读取；助手回答同时兼容 `assistant-step.data.blocks` 和当前 `turn-tail.data.closing.blocks`（`closing.finalNode` 只用于匹配 `messageId`）。若 DSH Desktop 升级并更改这些 Web Client Slots 或 snapshot contract，请先使用其内置 CLI 导出 profile 配置，并依据新版 Slot contract 调整注册点。
