# Vendored sidechat implementation

This project embeds the `SideChatView`, sidechat transcript mapping, sidechat
core helpers, locale chrome, icons, and CSS from `dsh-better-sidebar@0.17.1`.
The code is kept in the private client module and the host runtime so the
sidechat tab and its `/sidebar/api/sidechat.*` lifecycle are owned by this
plugin even when another Better Sidebar version is installed.

Upstream source: <https://github.com/omdsh-dev/DSH-better-sidebar>

The embedded implementation was inspected from the published package on
2026-09-07. Changes made here are limited to the project-owned API adapter and
the reference-chip draft bridge; the panel layout and sidechat interaction
remain the upstream 0.17.1 implementation.

See [LICENSE](./LICENSE) for the upstream MIT license.
