# dsh-harness-chat-control

Quote-and-follow-up for DSH Desktop: select any sentence in an answer, carry it into the main conversation or an independent side conversation, and stop a running answer to rewrite the question in place.

[中文](README.md) · [日本語](README_JA.md) · [한국어](README_KO.md)

## Screenshots

**Select to quote** — select a passage in an answer; the floating toolbar offers “添加到对话 / 更多详情 / 在侧边聊天中提问”.

![Selection toolbar](docs/screenshots/selection-toolbar.png)

**Side conversation** — the quote is carried into an independent thread on the right; the main conversation keeps going, and the quote sits in the composer as a reference chip.

![Side conversation](docs/screenshots/side-chat.png)

**Rewrite while generating** — click the pencil during generation: the current turn stops, the original question returns to the composer, and you send the edited version.

![Rewrite while generating](docs/screenshots/edit-stop-resend.png)

**Batch close tabs** — right-click a tab in the right panel to close other tabs, tabs to the left, or tabs to the right.

![Batch close tabs](docs/screenshots/tab-batch-close.png)

## Highlights

- **Native annotation chips**: quotes never enter the message body; they appear as a `1 条注释` chip that you can keep, edit around, or remove before sending. No `>` or `---` Markdown markers leak into the text.
- **Truly independent side threads**: every side conversation is its own child session with its own model, stop and send state, so a running main answer never overwrites a side question.
- **Edit mid-generation**: clicking “编辑消息” stops the current turn first, then refills and focuses the matching composer — no more “text copied into the box while the model keeps thinking”.
- **Self-contained sidebar**: ships and pins the `dsh-better-sidebar@0.28.0` side-conversation implementation, so nothing else needs to be installed and other versions cannot conflict.

## Host requirements

| Component | Requirement |
| --- | --- |
| DSH Desktop (Windows) | `0.12.1` |
| Harness runtime | `0.2.1-rc.2` |
| Bundled `dsh-better-sidebar` | `0.28.0` (shipped with the plugin) |
| Node.js | `>= 20` |
| pnpm | `10.x` / `11.x` |

The plugin pins Harness `0.2.1-rc.2` in `peerDependencies`. The host compares declared requirements before importing a plugin and rejects mismatches with the unmet entries listed, so upgrade the plugin before moving to a new Harness major instead of bypassing the check.

## Install (hand this to an agent)

Give this section to the agent inside DSH. It runs the command and handles failures; no manual config editing is needed.

```powershell
# 1. Quit DSH Desktop completely
# 2. Install into the web profile with the official plugin command
dsh plugin --profile web add --save-exact --allow-build=node-pty "git+https://github.com/1985899182/dsh-harness-chat-control.git#v0.3.10"
# 3. Start DSH Desktop again
```

If `dsh` is not on PATH, use the CLI bundled with the desktop app (same command underneath):

```powershell
$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
$env:PATH = "$env:DSH_HOME\.desktop-bin;$env:PATH"
$cli = '<DSH Desktop install dir>\resources\app.asar\node_modules\@deepseek-ai\dsh\lib\bin.js'
& "$env:DSH_HOME\.desktop-bin\node.cmd" $cli plugin --profile web add --save-exact --allow-build=node-pty "git+https://github.com/1985899182/dsh-harness-chat-control.git#v0.3.10"
```

When something fails, change course by symptom:

| Symptom | What to change |
| --- | --- |
| `dsh` is not recognized | Use the bundled-CLI form above and make sure `.desktop-bin` is on PATH |
| `Ignored build scripts` / `allowBuilds` warning | Add the printed package names under `allowBuilds` in `%APPDATA%\dsh-desktop\harness\profiles\web\pnpm-workspace.yaml`, or re-run with `--allow-build=<package>` |
| `incompatible-version` | The runtime does not match the Harness version the plugin declares; return to `0.2.1-rc.2` or upgrade the plugin |
| Hangs, times out or returns 401 | Set `HTTP_PROXY` / `HTTPS_PROXY` and retry; keep the Git spec as an explicit `https://` URL |
| Nothing changed in the UI | Quit and reopen DSH Desktop; for an upgrade of a live plugin, refresh the page as prompted |

## Changelog

- **v0.3.10**: side conversations accept a picked or pasted picture; adds a host compatibility checklist and an automated seam check (runs with `npm test`).
- **v0.3.9**: the side composer hides the unusable “+” and the host's context meter; “编辑消息” during generation now stops the turn before refilling.
- **v0.3.8**: side conversations run independently and no longer overwrite each other's question; dead code removed.
- Older releases: [MILESTONE.md](MILESTONE.md).

## License

MIT
