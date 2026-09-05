/**
 * Host half of the plugin.
 *
 * The browser side owns the composer UI.  One small host route is additionally
 * required because Better Sidebar 0.17.1 intentionally rejects the public
 * `session.selectModel` RPC for addressed subagent sessions.  The route only
 * validates a Better Sidebar sidechat child and records the selection for its
 * next request; it never reads credentials or rewrites the parent session.
 */
export const name = 'dsh-harness-chat-control'

const MODEL_ROUTE = '/dsh-harness-chat-control/sidechat-model'
const MAX_MODEL_BODY_BYTES = 64 * 1024
const MAX_MODEL_FIELD_LENGTH = 256
const PENDING_SELECTION_TTL_MS = 2 * 60 * 1000

class SidechatModelError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function getService(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res, error) {
  if (error instanceof SidechatModelError) {
    writeJson(res, error.status, {
      ok: false,
      error: { code: error.code, message: error.message }
    })
    return
  }
  writeJson(res, 500, {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error) }
  })
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_MODEL_BODY_BYTES) throw new SidechatModelError('bad-request', 'request body too large', 413)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new SidechatModelError('bad-request', 'request body is not valid JSON')
  }
}

function requireField(payload, key) {
  const value = payload?.[key]
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_MODEL_FIELD_LENGTH) {
    throw new SidechatModelError('bad-request', `missing or invalid "${key}"`)
  }
  return value.trim()
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase()
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true
  const parts = normalized.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

function trustedAuthority(hostUrl, trustedHosts) {
  for (const entry of Array.isArray(trustedHosts) ? trustedHosts : []) {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) continue
    if (entryUrl.hostname === hostUrl.hostname) {
      if (entryUrl.port === '' || entryUrl.port === hostUrl.port) return true
    }
    if (entryUrl.host === hostUrl.host) return true
  }
  return false
}

/** Same Host/Origin fence used by Better Sidebar's own JSON routes. */
function trustedRequest(ctx, req) {
  const authority = typeof req?.headers?.host === 'string' ? req.headers.host : ''
  const hostUrl = parseAuthority(authority)
  if (hostUrl === undefined) return false
  const runtime = ctx?.webRuntime || getService(ctx, 'webRuntime')
  const trustedHosts = runtime?.trustedHosts || []
  if (!isLoopbackHostname(hostUrl.hostname) && !trustedAuthority(hostUrl, trustedHosts)) return false
  if (req?.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req?.headers?.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}

function descriptorIsSidechat(events) {
  if (!Array.isArray(events)) return false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'subagent/descriptor') continue
    return event?.data?.provider === 'sidechat'
  }
  return false
}

function sidechatChildOf(ctx, childId) {
  const agents = getService(ctx, 'agents')
  const agent = agents?.get?.(childId)
  if (agent !== undefined) {
    const header = agent.session?.header
    const parentSession = header?.parentSession || header?.parentSessionId
    if (header?.origin !== 'subagent' || typeof parentSession !== 'string' || parentSession === '') return undefined
    if (!descriptorIsSidechat(agent.session?.events)) return undefined
    return { agent }
  }
  const persistence = getService(ctx, 'sessionPersistence')
  if (typeof persistence?.inspect !== 'function') return undefined
  return Promise.resolve().then(() => persistence.inspect(childId)).then((inspected) => {
    const meta = inspected?.meta || inspected?.header || {}
    const parentSession = meta.parentSession || meta.parentSessionId
    if (meta.origin !== 'subagent' || typeof parentSession !== 'string' || parentSession === '') return undefined
    if (!descriptorIsSidechat(inspected?.events)) return undefined
    return { agent: undefined }
  }).catch(() => undefined)
}

function normalizedSelection(resolved) {
  if (typeof resolved?.provider !== 'string' || typeof resolved?.model !== 'string') {
    throw new SidechatModelError('model-unavailable', '模型目录未返回可用的 provider/model', 400)
  }
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...(typeof resolved.reasoningEffort === 'string' && resolved.reasoningEffort !== ''
      ? { reasoningEffort: resolved.reasoningEffort }
      : {})
  }
}

function createSidechatModelRoute(ctx) {
  const pending = new Map()
  const pendingTimers = new Map()
  const logger = ctx?.logger

  function forgetPending(childId) {
    pending.delete(childId)
    const timer = pendingTimers.get(childId)
    if (timer !== undefined) clearTimeout(timer)
    pendingTimers.delete(childId)
  }

  function rememberPending(childId, selection) {
    forgetPending(childId)
    pending.set(childId, selection)
    const timer = setTimeout(() => forgetPending(childId), PENDING_SELECTION_TTL_MS)
    timer.unref?.()
    pendingTimers.set(childId, timer)
  }

  function installSelection(agent, selection) {
    const controller = ctx?.sessionController || getService(ctx, 'sessionController')
    const agents = controller?.agents
    if (typeof agents?.selectForNextRequest !== 'function') {
      throw new SidechatModelError('unavailable', '当前 DSH 没有可用的模型选择服务', 503)
    }
    // This is the same durable seam used by SessionCommandController, but it
    // deliberately skips that controller's top-level-session ownership fence:
    // Better Sidebar owns this addressed child and has already passed the
    // sidechat descriptor check above.
    agents.selectForNextRequest(agent, selection)
  }

  const onCreated = (payload) => {
    const agent = payload?.agent
    const childId = typeof agent?.id === 'string' ? agent.id : undefined
    if (childId === undefined) return
    const selection = pending.get(childId)
    if (selection === undefined) return
    forgetPending(childId)
    try {
      installSelection(agent, selection)
    } catch (error) {
      logger?.warn?.(`[dsh-harness-chat-control] deferred sidechat model selection failed: ${String(error)}`)
    }
  }
  const removeCreatedListener = typeof ctx?.on === 'function' ? ctx.on('agent/created', onCreated) : undefined

  const handler = async (req, res) => {
    if (!trustedRequest(ctx, req)) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      return
    }
    try {
      const payload = await readJsonBody(req)
      const childId = requireField(payload, 'childId')
      const provider = requireField(payload, 'provider')
      const model = requireField(payload, 'model')
      const rawReasoningEffort = payload?.reasoningEffort
      if (rawReasoningEffort !== undefined
        && (typeof rawReasoningEffort !== 'string' || rawReasoningEffort.trim() === '' || rawReasoningEffort.length > MAX_MODEL_FIELD_LENGTH)) {
        throw new SidechatModelError('bad-request', 'invalid "reasoningEffort"')
      }
      const child = await sidechatChildOf(ctx, childId)
      if (child === undefined) throw new SidechatModelError('not-found', '目标不是可用的 Better Sidebar 侧边会话', 404)
      const llm = ctx?.llm || getService(ctx, 'llm')
      if (typeof llm?.resolveCallConfig !== 'function') throw new SidechatModelError('unavailable', '当前 DSH 没有可用的模型目录', 503)
      let resolved
      try {
        resolved = await llm.resolveCallConfig({
          provider,
          model,
          ...(rawReasoningEffort === undefined ? {} : { reasoningEffort: rawReasoningEffort.trim() })
        })
      } catch (error) {
        throw new SidechatModelError('model-unavailable', error instanceof Error ? error.message : String(error), 400)
      }
      const selected = normalizedSelection(resolved)
      if (child.agent !== undefined) {
        installSelection(child.agent, selected)
        forgetPending(childId)
      } else {
        // AgentRegistry.resume announces the cold child synchronously before
        // Better Sidebar admits its first follow-up.  The listener above
        // applies this pending value at that exact lifecycle edge.
        rememberPending(childId, selected)
        const raced = getService(ctx, 'agents')?.get?.(childId)
        if (raced !== undefined) {
          forgetPending(childId)
          installSelection(raced, selected)
        }
      }
      writeOk(res, { selected })
    } catch (error) {
      writeError(res, error)
    }
  }

  return {
    handler,
    dispose() {
      removeCreatedListener?.()
      for (const timer of pendingTimers.values()) clearTimeout(timer)
      pendingTimers.clear()
      pending.clear()
    }
  }
}

export function apply(ctx) {
  const registerRoute = () => {
    const webServer = ctx?.webServer || getService(ctx, 'webServer')
    if (typeof webServer?.register !== 'function') {
      ctx?.logger?.warn?.('[dsh-harness-chat-control] webServer unavailable; sidechat model selector route disabled')
      return undefined
    }
    const route = createSidechatModelRoute(ctx)
    let disposeRoute
    try {
      disposeRoute = webServer.register({ kind: 'exact', path: MODEL_ROUTE, handler: route.handler })
    } catch (error) {
      route.dispose()
      throw error
    }
    return () => {
      try { disposeRoute?.() } finally { route.dispose() }
    }
  }
  if (typeof ctx?.effect === 'function') ctx.effect(registerRoute, 'dsh-harness-chat-control: sidechat model route')
  else registerRoute()

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
