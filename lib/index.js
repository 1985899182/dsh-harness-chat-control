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
    let clientMeta
    let clientLocate
    let clientTable
    let clientSource
    let clientPackageCache
    try {
      clientLocate = typeof clientModules?.locatePkgJson === 'function'
        ? clientModules.locatePkgJson(name, self?.baseUrl)
        : undefined
      clientMeta = typeof clientModules?.resolveMeta === 'function'
        ? clientModules.resolveMeta(name, self?.baseUrl)
        : undefined
      clientTable = typeof clientModules?.table?.get === 'function'
        ? clientModules.table.get(name)?.entry
        : undefined
      clientSource = typeof clientModules?.sources?.values === 'function'
        ? [...clientModules.sources.values()]
            .filter((source) => source.packageName === name)
            .map((source) => ({
              loaderName: source.loaderName,
              baseUrl: source.baseUrl,
              sourceKey: source.sourceKey,
            }))
        : undefined
      clientPackageCache = typeof clientModules?.pkgMeta?.get === 'function'
        ? clientModules.pkgMeta.get(`${self?.baseUrl}\u0000${name}`)
        : undefined
    } catch (error) {
      clientMeta = { error: error instanceof Error ? error.message : String(error) }
    }
    let resolution
    const internal = ctx?.loader?.internal
    const resolver = typeof internal?.resolveSync === 'function'
      ? internal.resolveSync.bind(internal)
      : undefined
    if (self?.baseUrl && typeof resolver === 'function') {
      try {
        const resolved = internal.version === 'v2'
          ? resolver(self.baseUrl, { specifier: name, attributes: {} })
          : resolver(name, self.baseUrl, {})
        resolution = { url: resolved?.url, version: internal.version }
      } catch (error) {
        resolution = { error: error instanceof Error ? error.message : String(error) }
      }
    }
    console.warn('[dsh-harness-chat-control] loader diagnostic', JSON.stringify({
      self,
      resolution,
      clientService: clientModules?.constructor?.name,
      clientInternalVersion: internal?.version,
      clientInternalKeys: internal === undefined ? [] : Object.keys(internal),
      clientLocate,
      clientMeta,
      clientTable,
      clientSource,
      clientPackageCache,
      graphEntries: Array.isArray(graph?.entries)
        ? graph.entries.filter((entry) => entry.id === name)
        : [],
    }))
  }
  const rescan = (label) => {
    let service
    try {
      service = typeof ctx?.get === 'function' ? ctx.get('clientModules') : undefined
    } catch {
      service = undefined
    }
    const errors = []
    if (service?.dirty?.add && typeof service.flush === 'function') {
      // Older DSH Desktop builds can mount a late plugin after the registry's
      // initial synchronous scan without emitting the registry event.  Mark
      // only this package dirty and use the registry's own reconciliation path
      // so no host state or session data is touched.
      service.dirty.add(name)
      service.flush((error) => errors.push(error instanceof Error ? error.message : String(error)))
    }
    if (errors.length > 0 || label === 'timer') {
      console.warn('[dsh-harness-chat-control] loader rescan', JSON.stringify({ label, errors }))
      report()
    }
  }
  report()
  queueMicrotask(() => rescan('microtask'))
  const timer = setTimeout(() => rescan('timer'), 250)
  timer.unref?.()
}
