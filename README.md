# DSH Harness Chat Control

一个面向 **DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）的原生插件，提供接近 ChatGPT 的会话交互补强：停止并修改重发、引用 AI 输出到主对话，以及右侧侧栏追问。

## 功能

- **停止并编辑重发**：在输入框上方显示最近一条用户消息。生成中点击“停止并编辑”会调用 DSH 的取消接口；修改后重新发送时，仍在运行则采用 `steer`（打断当前轮次），空闲时采用 `queue`（开启下一轮）。
- **回答引用**：每个已完成 AI 回答的操作条新增“引用”和“侧栏问”。先选中文字可只引用选区；未选中时引用整条回答。
- **主对话追问**：“引用”会把 Markdown 引用和追问提示追加到主输入框，不会自动发送，方便继续编辑。
- **右侧侧栏追问**：“侧栏问”会带着引用打开右侧面板。面板中的问题以排队消息发送到原会话，因此不会打断正在生成的回答。
- **侧栏入口**：左侧导航底部提供“侧栏追问”按钮，可重新打开面板或清除引用后普通提问。

## 重要语义

DSH 的会话日志是追加式的，因此“编辑重发”不会删除历史消息。它会把修订后的文本作为新的 `steer` 或 `queue` 消息提交；这既保留审计轨迹，也能在生成中立即转向修订后的问题。

引用输出时，插件会在侧栏追问的提示中明确把引用内容标为“上下文”，避免其中的文本意外覆盖你的追问。

## 安装

适用环境：**DSH Desktop 0.7.2**（内置 DeepSeek Harness `0.1.2-alpha.1`）、Node.js 20+、Windows PowerShell、Git 和 pnpm 10.x/11.x。桌面版使用自己的 Harness home：`%APPDATA%\dsh-desktop\harness`，而非 `~\.dsh`。

安装器通过 DSH Desktop 内置 CLI 管理插件依赖和 bundle 注册；它不会手动改写 `cordis.patch.yml`，也不会修改模型、会话或凭据。

### 一键安装

先**完全退出 DSH Desktop**，再在 PowerShell 中执行（当前稳定版本）：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.5/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.5'
```

脚本会自动定位常见的 DSH Desktop 安装目录（包括 `D:\DSH\DSH Desktop` 与 `%LOCALAPPDATA%\Programs\DSH Desktop`），设置正确的 Desktop Harness home，并使用桌面版自带的 generation installer 将 GitHub 插件放入独立代际；这一步比直接写入共享 `node_modules` 更可靠，能保证 Web Client 在冷启动时发现插件。旧版本留下的共享安装会先被安全移除。

```powershell
dsh plugin --profile web add --save-exact github:1985899182/dsh-harness-chat-control#v0.2.5
```

随后它会读取 `%APPDATA%\dsh-desktop\harness\profiles\web\package.json`，确认 `dependencies`、`dsh.profile.bundles` 和代际投影都已包含 `dsh-harness-chat-control`。如果 profile 之前由 pnpm 10 建立、而当前 PATH 是 pnpm 11，安装器会临时通过 Corepack 使用 profile 记录的 pnpm 主版本，不会强制重装整个 profile。成功后请重新打开 DSH Desktop；Desktop 版不依赖浏览器硬刷新。

如安装目录不在自动探测范围内，或想先只查看将要执行的操作：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.5/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -DesktopRoot 'D:\DSH\DSH Desktop' -Profile 'web' -Ref 'v0.2.5' -DryRun
```

`-Ref` 可以换成已发布的 Git tag 或提交 SHA，以固定安装版本。通过 `main` 安装时，更新只需在完全退出 DSH Desktop 后重新执行一键命令；若使用 `main`，脚本地址也相应改为 `.../main/scripts/install.ps1`。

为兼容 DSH Desktop 0.7.2 的 GitHub 更新检测，发布版本请使用**轻量 tag**（例如 `git tag v0.2.5`），不要使用带注释的 `git tag -a`。该 Desktop 版本直接比较 `refs/tags/*` 返回值；带注释的 tag 返回 tag object，而不是实际提交，会造成“更新后版本没有变化”的误报。

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

桌面端的 Chat snapshot 通过 `useChat` 提供；用户消息从 `node.data.content` 读取；助手回答同时兼容 `assistant-step.data.blocks` 和当前 `turn-tail.data.closing.blocks`（`closing.finalNode` 只用于匹配 `messageId`）。若 DSH Desktop 升级并更改这些 Web Client Slots 或 snapshot contract，请先使用其内置 CLI 导出 profile 配置，并依据新版 Slot contract 调整注册点。
