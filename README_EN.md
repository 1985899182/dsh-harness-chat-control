# dsh-harness-chat-control

[简体中文](README.md) · [日本語](README_JA.md) · [한국어](README_KO.md)

Bring ChatGPT-like conversation interactions to DSH Desktop.

> **Project goal: reproduce ChatGPT's two quote-based conversation workflows.**
>
> 1. **Quote in the main chat**: quote an answer and continue asking in the same conversation.
> 2. **Quote in the sidebar chat**: carry the quote into Better Sidebar and ask in an independent sidebar session without changing the main chat.

## UI examples

### Quote in the main chat

Select text in an answer or click **Quote** in its action bar. The quote stays in the composer as an annotation chip; edit your question before sending.

![Main-chat quote example](docs/screenshots/main-conversation-quote.svg)

### Quote in the sidebar chat

Click **Ask in sidebar** or choose **Ask in sidebar chat** from the text-selection toolbar. The sidebar keeps Better Sidebar's native composer and model selector. Text outside the quote chip is entirely user input, and nothing is sent until you click Send.

![Sidebar quote example](docs/screenshots/sidebar-conversation-quote.svg)

## Features

- **Main-chat quotes**: quote a full answer or a selected fragment without leaking Markdown markers such as `>` or `---` into the prompt.
- **Native annotation chip**: the composer shows the quote as a `1 annotation` chip. You can edit the question or remove the chip before sending.
- **Embedded sidebar**: embeds and pins the `dsh-better-sidebar@0.17.1` `SideChatView`, transcript mapping, and styles. It works without Better Sidebar installed, and this project's sidechat remains authoritative when another version is present.
- **Sidebar quote**: keeps Better Sidebar's native conversation layout and DSH's session/model capabilities. Main and sidebar sessions stay independent.
- **Model selection**: the native model selector applies only to the current sidebar session.
- **Edit and resend**: click the pencil next to a user message to load the original text into the native composer. Sending replaces the visible branch in the same conversation instead of creating duplicate chats.
- **Stop generation**: reuses DSH's native stop/send state and does not intercept or submit native events twice.

The plugin adds the quote chip, entry points, and session routing; the sidebar layout, transcript, and child-session lifecycle come from the pinned Better Sidebar 0.17.1 source so another plugin version cannot take over.

## Compatibility

| Component | Version |
| --- | --- |
| DSH Desktop (Windows) | `0.7.2` |
| DeepSeek Harness / `@deepseek-ai/dsh` | `0.1.2-alpha.1` |
| `dsh-better-sidebar` | **`0.17.1`** |
| Node.js | `>=20` |
| pnpm | `10.x` or `11.x` |

`dsh-better-sidebar@0.18.x` targets Harness `0.1.2-rc.1+` and reads `connection.state.getSnapshot()`, which is not available in alpha.1. Pin Sidebar to `0.17.1` on DSH Desktop `0.7.2`; otherwise opening a new chat may fail with `Cannot read properties of undefined (reading 'getSnapshot')`.

## Install

Run the current stable installer in Windows PowerShell:

```powershell
$script = (irm 'https://raw.githubusercontent.com/1985899182/dsh-harness-chat-control/v0.2.61/scripts/install.ps1').TrimStart([char]0xFEFF)
& ([scriptblock]::Create($script)) -Ref 'v0.2.61'
```

The installer adds the plugin to the DSH Desktop `web` profile. A first generation install, or an install when the plugin is not live, is staged and clearly asks for a full DSH Desktop restart. Only an upgrade of an already-live plugin synchronizes the Web Client through HMR; refresh the page with `Ctrl+R` afterward.

The source is an explicit HTTPS Git URL, so pnpm does not reinterpret the GitHub shorthand as SSH. The installer first checks existing `HTTP_PROXY`/`HTTPS_PROXY` values and the WinINET proxy, then passes the result to pnpm, git, and node. You can also set it explicitly:

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.61' -Proxy 'http://127.0.0.1:7897'
```

For a slow registry, set a registry URL and retry count:

```powershell
& ([scriptblock]::Create($script)) -Ref 'v0.2.61' -Registry 'https://registry.npmjs.org/' -FetchRetries 5
```

The command evaluates the downloaded script from an in-memory `scriptblock`, so it does not require changing the PowerShell execution policy. If you save it as a `.ps1` file and run it directly, use `powershell -ExecutionPolicy Bypass -File`.

If the profile already uses Sidebar `0.18.x`, run this compatibility fix first:

```powershell
$desktopNode = 'D:\DSH\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
$desktopDsh = 'D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
& $desktopNode $desktopDsh plugin --profile web add --save-exact dsh-better-sidebar@0.17.1
```

Then run the stable installer again and refresh the page.

If dshmarket returns HTTP 502 or another hot-mount error, the installer prints a token-redacted status and response body and tells you to cold-start DSH; a proxy timeout is not reported as a successful install.

## Usage

1. **Main chat**: click **Quote** in an answer's action bar, or select text and choose **Add to chat**; add your question and send it.
2. **Sidebar chat**: click **Ask in sidebar**, or choose **Ask in sidebar chat** from the selection toolbar; select a model, enter your question, and send it.
3. **Edit and resend**: click the pencil beside a user message, edit the text in the native composer, and send. The new answer appears at the original position.

## Development

```powershell
npm test
```

This validates the manifest, loader declarations, PowerShell installer, and JavaScript syntax.

## Release

Current milestone: **`v0.2.61`**, validated against DSH Desktop `0.7.2` / Harness `0.1.2-alpha.1`, with `dsh-better-sidebar@0.17.1` sidechat embedded. Recheck native Slots, sidechat API, and state interfaces after upgrading DSH or the Harness major version.

## License

MIT
