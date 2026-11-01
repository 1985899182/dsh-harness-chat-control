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
- **内置侧边栏**：直接内置并锁定 `dsh-better-sidebar@0.28.0` 的 `SideChatView`、转录映射和样式；未安装 Better Sidebar 时也能使用，已安装其他版本时仍由本项目的侧边实现生效。
- **侧边栏引用**：沿用 Better Sidebar 原生对话布局和 DSH 原生会话/模型能力；主会话与侧边会话相互独立。
- **侧边原生对话栏**：权限、模型菜单、停止和发送状态都由原生对话栏负责，避免重复事件导致整页卡死。
- **模型选择**：侧边会话直接使用原生模型选择器，模型设置只作用于当前侧边会话。
- **编辑并重发**：用户消息点击铅笔后回到原生输入框；发送后在原会话位置覆盖显示新的分支，不创建一串重复新会话。
- **停止回答**：复用 DSH 原生停止/发送状态，引用和侧边栏不会拦截或重复提交原生事件。

插件只增加引用胶囊、入口和会话路由；侧边栏的布局、转录和会话生命周期来自锁定的 Better Sidebar 0.28.0 源码，避免外部插件版本冲突。

## 适配版本

| 组件 | 版本 |
| --- | --- |
| DSH Desktop（Windows） | `0.12.1` |
| DeepSeek Harness / `@deepseek-ai/dsh` | `0.2.1-rc.2` |
| `dsh-better-sidebar` | **`0.28.0`** |
| Node.js | `>=20` |
| pnpm | `10.x` 或 `11.x` |

`dsh-better-sidebar@0.28.0` 面向 Harness `0.2.1-rc.2`。使用 DSH Desktop `0.12.1`（内置 Harness `0.2.1-rc.2`）时请固定为 `0.28.0`。Harness `0.2.1-rc.2` 移除了 `webRuntime` 服务，本插件改用 `connection.requestRejection()` 做请求准入。

## 安装

统一使用 DSH 官方插件命令安装。先完全退出 DSH Desktop，在 Windows PowerShell 中执行：

```powershell
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
dsh plugin --profile web add --save-exact --allow-build=node-pty "git+https://github.com/1985899182/dsh-harness-chat-control.git#v0.3.9"
```

如果 `dsh` 不在 PATH，使用 DSH Desktop 自带的 CLI；底层仍是同一条 `dsh plugin` 安装命令：

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode $desktopDsh plugin --profile web add --save-exact --allow-build=node-pty "git+https://github.com/1985899182/dsh-harness-chat-control.git#v0.3.9"
```

命令使用显式 HTTPS Git 地址，避免 pnpm 将 GitHub 简写解析成 SSH。若本机通过代理联网，请在执行前设置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`。首次安装或当前插件尚未运行时，安装完成后请完全退出并重新打开 DSH Desktop；已运行插件的升级按 DSH 提示刷新页面即可。

如果 profile 中已经是 Sidebar `0.28.x`，仍然使用同一个 `dsh plugin` 命令先固定兼容版本：

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode $desktopDsh plugin --profile web add --save-exact --allow-build=node-pty dsh-better-sidebar@0.28.0
```

然后重新执行上面的标准安装命令。

## 使用方式

1. **主对话**：在回答操作栏点击“引用”，或选中文字后选择“添加到对话”；在输入框中补充问题，再发送。
2. **侧边栏对话**：点击“侧栏问”，或在选中文字工具条选择“在侧边聊天中提问”；侧边栏打开后选择模型、输入问题，再发送。
3. **编辑重发**：点击用户消息旁的铅笔按钮，在原生输入框修改文字并发送；当前会话会在原位置显示新回答。
4. **标签管理**：右击右侧栏的标签，菜单中可直接“关闭其他标签”“关闭右侧标签”“关闭左侧标签”。

## 开发校验

```powershell
npm test
```

校验清单、加载器声明、PowerShell 安装脚本和 JavaScript 语法。

## 版本

当前里程碑：**`v0.3.9`**，适配上表中的 DSH Desktop `0.11.0` / `0.12.0` 与 Harness `0.2.0-rc.2`，并内置 `dsh-better-sidebar@0.28.0` 的侧边对话实现。本版修两处交互。其一，侧边对话输入框左侧的「+」不再出现：侧边会话是独立的子会话，宿主没有对应的斜杠命令控制器，这个按钮会一直处于禁用态、点了毫无反应，现在直接隐藏，输入框下方宿主自带的上下文占用指示（那枚「21%」小圆环）也一并隐藏，侧边输入框只保留文字、引用和模型选择。其二，主对话或侧边对话正在生成时点击「编辑消息」，会先暂停该会话进行中的回合，再把原消息回填到对应的输入框并聚焦——主对话回到主输入框，侧边消息回到它自己那一栏的输入框，不再出现“只把文字复制进输入框、思考继续跑”的情况。桌面版已实测：主对话生成中点编辑会立即停止并回填，侧边对话生成中点编辑会立即停止该侧边回合并回填，侧边输入框的「+」已隐藏而主输入框的「+」仍然可用。升级 DSH 或 Harness 主版本后，请重新验证原生 Slots、侧边对话 API 和状态接口。

## 许可证

MIT
