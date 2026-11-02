# 宿主兼容清单

插件通过 DSH 的公开接缝工作，每次升级 DSH（Harness / Better Sidebar）都可能挪动其中某一条。
升级后先跑：

```bash
npm test                       # 静态与加载器校验 + 宿主接缝探测
node scripts/compat-check.mjs  # 只跑宿主接缝探测（需已安装 DSH Desktop）
```

`compat-check` 会打印 `PASS/FAIL <id>`；`FAIL` 的 id 对照下表排查，`SKIP` 说明本机没找到宿主包。

## 当前版本支持范围

| 项 | 值 |
| --- | --- |
| Harness (`engines.dsh` / `@deepseek-ai/dsh-*` peer) | `0.2.1-rc.2` |
| Better Sidebar | `0.28.0` |
| Node / pnpm | `>=20` / `>=10 <12` |
| 安装 | `dsh plugin --profile web add --save-exact dsh-harness-chat-control` |

宿主在导入插件前会比对 `engines.dsh` 与 peer，版本不符会直接拒绝并列出未满足项——改版本时这三处要一起改。

## 清单

| 编号 | 功能 | 依赖的宿主接缝 | 自动检测 | 升级时先看什么 |
| --- | --- | --- | --- | --- |
| C1 | 主对话划选引用 | 选区监听 + `shell.overlay` 槽 + 会话输入注入 | 手动 | 工具栏是否还浮在选区旁；引用 chip 是否仍进主输入框 |
| C2 | 侧边引用 | Better Sidebar 的 tab 描述符 + `sidechat.start` | 手动 | 引用后是否新开独立标签；引用文本是否只进该标签 |
| C3 | 编辑消息·中断重发 | 主：`session.cancel()`；侧：`sidechat.cancel` + 视图重挂 | `session.cancel` | 运行中点「编辑」后是否先停、再回填并聚焦；「停止生成」是否消失 |
| C4 | 侧边对话独立 | `origin: 'subagent'` 私有关联子会话 + 边界注入 | `session.subagent-images` | 主对话提问是否仍会覆盖侧边问题；侧边是否继承已完成轮次 |
| C5 | 侧边图片输入 | 图片内容块 `{ type: 'image', mediaType, data }` + 子会话 prompt 允许图片 | `session.image-part`、`session.subagent-images` | 选择/粘贴图片是否有缩略图；发送后模型能否看到图片 |
| C6 | 侧边隐藏「+」 | 宿主 `_add` / `_tools` 类名 | `composer.plus-button` | 「+」是否又出现在侧边工具行（子会话没有指令触发器，按钮恒 disabled） |
| C7 | 侧边隐藏上下文占用 | 上下文指示器（`aria-haspopup="dialog"` + `context.aria`） | `composer.context-meter` | 侧边输入框下方是否又出现「21%」 |
| C8 | 侧边输入框挂载 | `conversation.composer.bar`、`conversation.input.attachments`、`data-composer-input` | `composer.slot`、`composer.input` | 侧边是否显示「正在准备侧边对话输入框…」 |
| C9 | 标签批量关闭 | Better Sidebar 的 tab 菜单与 `closeTab` 族 | 手动 | 右键标签菜单是否仍有「关闭其他／左侧／右侧」 |
| C10 | 市场卡片宿主要求 | npm 上的 manifest：`engines.dsh` 或 `@deepseek-ai/dsh-*` peer | 手动（`registry.npmjs.org/<包>/latest`） | 卡片显示「宿主要求未知」= npm 上读不到 manifest |
| C11 | 安装命令 | `dsh plugin --profile <profile> add`（参数原样转给 profile 的 pnpm） | 手动 | `dsh plugin --help` 是否仍有 `add`、`--allow-build`、`--save-exact` |
| C12 | 侧边对话划选引用 | 侧边转录的 `.dshhc-sidechat-view` / `.dshhc-sidechat-native-view` 包围层 + `sessions.subagentAddress(child).parentSessionId` | `session.subagent-address` | 在侧边对话里划选是否出现工具条；「添加到对话」是否进主会话输入框而不是子会话 |
| C13 | 编辑铅笔不串标签 | 聊天行的 `data-chat-flow-kind` / `data-chat-flow-key` / `data-turn-tail`；标签切换只改 class/style | `chat.flow-rows` | 切主会话或侧边标签后，铅笔是否还停在旧标签坐标；旧标签的铅笔是否消失 |
| C14 | 铅笔走原地替换 | `conversation.input.dock` 槽 + InputBar 的 `inputTriggers.serializeReference`（引用 chip 先序列化再提交） | `composer.dock` | 修改一条带引用 chip 的消息后，是否原地替换旧轮次而不是新开一轮 |

## 升级 DSH 后的处理顺序

1. 改 `package.json` 的 `version`、`engines.dsh`、三处 `@deepseek-ai/dsh-*` peer；
2. 跑 `node scripts/compat-check.mjs`，按 `FAIL` 的 id 查上表；
3. 手测 C1、C2、C3、C5、C9（这几项没有自动信号）；C12–C14 先确认 `compat-check` 三项 `PASS`，再各点一次：侧边划选引用、切标签看铅笔、改一条带引用 chip 的消息；
4. 同步 `scripts/validate.mjs` 里硬编码的版本号与 `scripts/install.ps1`、`scripts/install-generation.mjs` 的 `Ref`；
5. 发布 npm 后确认 `latest` 的 `engines.dsh` 可读，市场卡片的宿主要求才会更新。

## 已知的宿主行为（不要当成 bug 修）

- 子会话没有 `inputTriggers`，宿主的「+」（指令/附件）按钮对侧边输入框恒为 disabled，插件选择隐藏而不是伪造控制器；
- 子会话 prompt 明确拒绝 `file` 块（`subagent continuation does not accept files`），只接受图片块；
- 纯图片用户消息不会唤醒驱动器，且侧边转录把它渲染成空行，所以图片提问会自动补一句中性文本；
- `serializeDraftImages` 这层宿主接缝已在 0.2.1-rc.2 移除，不要再按老实现接宿主草稿附件。
