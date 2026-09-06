# dsh-harness-chat-control

[English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md)

让 DSH Desktop 的对话交互接近 ChatGPT。

> **项目目标：复刻 ChatGPT 的两种引用对话形式。**
>
> 1. **主对话引用**：在当前会话引用回答，输入问题后继续在原会话中回答。
> 2. **侧边栏引用对话**：把引用带到 Better Sidebar，在独立侧边会话中追问，主会话保持不变。

## 界面示例

### 主对话引用

选择回答中的文字，或点击回答操作栏的“引用”。引用会保留为输入框中的注释胶囊；用户编辑完问题后再发送。

![主对话引用示例](docs/screenshots/main-conversation-quote.svg)

### 侧边栏对话引用

点击“侧栏问”或选中文字工具条中的“在侧边聊天中提问”。侧边栏沿用 Better Sidebar 的原生对话栏，可切换模型；引用胶囊之外的文字全部由用户输入，点击发送后才会开始回答。

![侧边栏对话引用示例](docs/screenshots/sidebar-conversation-quote.svg)

## 功能

- **主对话引用**：引用整条回答或选中的片段；不会把 Markdown 标记（如 `>`、`---`）污染到正文。
- **原生注释胶囊**：引用在输入框中显示为 `1 条注释` 胶囊，用户可先编辑问题、移除引用，再决定是否发送。
- **侧边栏引用**：使用 `dsh-better-sidebar` 原生 `SideChatView` 和 DSH 原生 `InputBar`，不是另造一套输入框；主会话与侧边会话相互独立。
- **侧边原生对话栏**：权限、模型菜单、停止和发送状态都由原生对话栏负责，避免重复事件导致整页卡死。
- **模型选择**：侧边会话直接使用原生模型选择器，模型设置只作用于当前侧边会话。
- **编辑并重发**：用户消息点击铅笔后回到原生输入框；发送后在原会话位置覆盖显示新的分支，不创建一串重复新会话。
- **停止回答**：复用 DSH 原生停止/发送状态，引用和侧边栏不会拦截或重复提交原生事件。

插件只增加引用胶囊、入口和会话路由，输入框、权限、模型菜单、输出渲染均交给 DSH Harness 与 Better Sidebar 原生组件。

## 适配版本

| 组件 | 版本 |
| --- | --- |
| DSH Desktop（Windows） | `0.7.2` |
| DeepSeek Harness / `@deepseek-ai/dsh` | `0.1.2-alpha.1` |
| `dsh-better-sidebar` | **`0.17.1`** |
| Node.js | `>=20` |
| pnpm | `10.x` 或 `11.x` |

`dsh-better-sidebar@0.18.x` 面向 Harness `0.1.2-rc.1+`，会读取 alpha.1 没有的 `connection.state.getSnapshot()`。使用 DSH Desktop `0.7.2` 时请固定为 `0.17.1`，否则点击新对话可能出现 `Cannot read properties of undefined (reading 'getSnapshot')`。

## 安装

在 Windows PowerShell 中执行当前稳定版本的一键安装命令：

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.59/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.59'
```

安装器会把插件放入 DSH Desktop 的 `web` profile，并尝试热挂载当前运行的 Web Client。看到成功提示后刷新 DSH 页面（`Ctrl+R`）即可，不需要重启桌面端。

如果 profile 中已经是 Sidebar `0.18.x`，先执行兼容修复：

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode $desktopDsh plugin --profile web add --save-exact dsh-better-sidebar@0.17.1
```

然后重新执行上面的一键安装命令并刷新页面。

## 使用方式

1. **主对话**：在回答操作栏点击“引用”，或选中文字后选择“添加到对话”；在输入框中补充问题，再发送。
2. **侧边栏对话**：点击“侧栏问”，或在选中文字工具条选择“在侧边聊天中提问”；侧边栏打开后选择模型、输入问题，再发送。
3. **编辑重发**：点击用户消息旁的铅笔按钮，在原生输入框修改文字并发送；当前会话会在原位置显示新回答。

## 开发校验

```powershell
npm test
```

校验清单、加载器声明、PowerShell 安装脚本和 JavaScript 语法。

## 版本

当前里程碑：**`v0.2.59`**，适配上表中的 DSH Desktop `0.7.2` / Harness `0.1.2-alpha.1`。升级 DSH 或 Harness 主版本后，请重新验证原生 Slots 和状态接口。

## 许可证

MIT
