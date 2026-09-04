/**
 * Host half of the plugin.
 *
 * All interaction in this package lives in the DSH Web Client. Keeping the
 * host half empty means the plugin neither reads credentials nor changes the
 * agent loop, session log, or model configuration.
 */
export const name = 'dsh-harness-chat-control'

export function apply(ctx) {
  // Keep diagnostics opt-in.  This is useful when a DSH Desktop upgrade
  // changes loader composition, but the plugin must remain silent for normal
  // users and must never inspect credentials or session content.
  if (process.env.DSH_HARNESS_CHAT_CONTROL_DEBUG !== '1') return
  const report = () => {
    const entries = typeof ctx?.loader?.entries === 'function'
      ? [...ctx.loader.entries()].map((entry) => ({
          id: entry.options?.id,
          name: entry.options?.name,
          fiber: entry.fiber !== undefined,
          disabled: entry.disabled === true,
          baseUrl: entry.parent?.tree?.ctx?.baseUrl,
        }))
      : []
    const self = entries.find((entry) => entry.name === name)
    let clientModules
    try {
      clientModules = typeof ctx?.get === 'function' ? ctx.get('clientModules') : undefined
    } catch {
      clientModules = undefined
    }
    const graph = typeof clientModules?.graph === 'function' ? clientModules.graph() : undefined
    let resolution
    const resolver = ctx?.loader?.internal?.resolveSync
    if (self?.baseUrl && typeof resolver === 'function') {
      try {
        const resolved = ctx.loader.internal.version === 'v2'
          ? resolver(self.baseUrl, { specifier: name, attributes: {} })
          : resolver(name, self.baseUrl, {})
        resolution = { url: resolved?.url, version: ctx.loader.internal.version }
      } catch (error) {
        resolution = { error: error instanceof Error ? error.message : String(error) }
      }
    }
    console.warn('[dsh-harness-chat-control] loader diagnostic', JSON.stringify({
      self,
      resolution,
      graphEntries: Array.isArray(graph?.entries)
        ? graph.entries.filter((entry) => entry.id === name)
        : [],
    }))
  }
  report()
  const timer = setTimeout(report, 1000)
  timer.unref?.()
}
