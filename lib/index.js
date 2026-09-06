/**
 * Host half of the plugin.
 *
 * The browser side owns the composer UI.  The host routes below are the small
 * seams Better Sidebar 0.17.1 intentionally does not expose for an addressed
 * sidechat child: model selection and a history page for custom sidechat
 * children. The session-edit route is separate: it arms the already-open
 * ordinary Session for one surface replacement so the browser can use the
 * native prompt admission path. Every route validates its target before
 * reading or changing anything; none of them reads credentials.
 */
export const name = 'dsh-harness-chat-control'

const MODEL_ROUTE = '/dsh-harness-chat-control/sidechat-model'
const HISTORY_ROUTE = '/dsh-harness-chat-control/sidechat-history'
const SESSION_EDIT_ROUTE = '/dsh-harness-chat-control/session-edit'
const MAX_MODEL_BODY_BYTES = 64 * 1024
const MAX_MODEL_FIELD_LENGTH = 256
const MAX_EDIT_TEXT_LENGTH = MAX_MODEL_BODY_BYTES
const PENDING_SELECTION_TTL_MS = 2 * 60 * 1000
const HISTORY_MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
const DEFAULT_HISTORY_MESSAGES = 50
const MAX_HISTORY_MESSAGES = 500

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
  const runtime = getService(ctx, 'webRuntime')
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

function textFromMessage(message) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function sessionEventMap(events) {
  const bySeq = new Map()
  for (const [index, event] of events.entries()) {
    if (event !== null && typeof event === 'object' && Number.isSafeInteger(event.seq)) {
      bySeq.set(event.seq, event)
    } else if (Number.isSafeInteger(index)) {
      bySeq.set(index, event)
    }
  }
  return bySeq
}

/**
 * Read the current surface without assuming that every Harness build exposes
 * the same concrete collection type.  The native Session uses a getter that
 * returns an array; the replay fallback also makes edits work for a restored
 * session whose surface manager has not been materialized yet.
 */
function sessionSurfaceNodes(session, events, bySeq) {
  let raw
  try {
    raw = session?.surface?.nodes
  } catch {
    raw = undefined
  }
  let values = []
  if (Array.isArray(raw)) values = [...raw]
  else if (raw !== null && raw !== undefined && typeof raw[Symbol.iterator] === 'function') {
    try { values = [...raw] } catch { values = [] }
  }
  const direct = values.filter((seq) => Number.isSafeInteger(seq) && seq >= 0)
  if (direct.length > 0) return direct

  // SurfaceManager is normally authoritative.  This deterministic fold is a
  // compatibility fallback for older/cold Session wrappers that expose only
  // the event log.  It mirrors Session's append/replace positional contract.
  const folded = []
  for (const [index, event] of events.entries()) {
    const seq = Number.isSafeInteger(event?.seq) ? event.seq : index
    if (!Number.isSafeInteger(seq) || seq < 0) continue
    const op = event?.surfaceOp
    if (op === 'append') {
      folded.push(seq)
      continue
    }
    if (op?.op !== 'replace'
      || !Number.isSafeInteger(op.start)
      || !Number.isSafeInteger(op.end)) continue
    const startIndex = folded.indexOf(op.start)
    const endIndex = folded.indexOf(op.end)
    if (startIndex < 0 || endIndex < startIndex) continue
    folded.splice(startIndex, endIndex - startIndex + 1, seq)
  }
  // Keep the map argument meaningful for callers that pass a sparse persisted
  // event window; an empty fold still correctly reports “not found”.
  return folded.filter((seq) => bySeq.has(seq) || events[seq] !== undefined)
}

function replacementSources(event) {
  return Array.isArray(event?.sourceEventSeqs)
    ? event.sourceEventSeqs.filter((seq) => Number.isSafeInteger(seq) && seq >= 0)
    : []
}

/** Return true when a current replacement node descends from an old message. */
function surfaceNodeDescendsFrom(bySeq, nodeSeq, targetSeq, visiting = new Set()) {
  if (nodeSeq === targetSeq) return true
  if (visiting.has(nodeSeq)) return false
  visiting.add(nodeSeq)
  const event = bySeq.get(nodeSeq)
  const sources = replacementSources(event)
  if (sources.some((sourceSeq) => surfaceNodeDescendsFrom(bySeq, sourceSeq, targetSeq, visiting))) return true
  const op = event?.surfaceOp
  return op?.op === 'replace'
    && Number.isSafeInteger(op.start)
    && Number.isSafeInteger(op.end)
    && targetSeq >= op.start
    && targetSeq <= op.end
}

function sessionEditRange(session, startSeq, targetText) {
  const events = Array.isArray(session?.events) ? session.events : []
  const bySeq = sessionEventMap(events)
  const surfaceNodes = sessionSurfaceNodes(session, events, bySeq)
  if (surfaceNodes.length === 0) return undefined

  const isUserMessage = (seq) => {
    const event = bySeq.get(seq)
    return event?.type === 'user/message' && event.data?.source?.kind === 'user'
  }
  const messageText = (seq) => textFromMessage(bySeq.get(seq)?.data)
  const requestedSeq = Number.isSafeInteger(startSeq) && startSeq >= 0 ? startSeq : undefined
  let targetSeq = requestedSeq

  // The first edit targets the append-origin user event directly.  Later edits
  // still point at that same DOM row, while the prior replacement has shadowed
  // it in the model surface.  Follow sourceEventSeqs through the replacement
  // chain to the current user node before falling back to text matching.
  if (targetSeq === undefined || !surfaceNodes.includes(targetSeq) || !isUserMessage(targetSeq)) {
    targetSeq = surfaceNodes.find((seq) => {
      return isUserMessage(seq)
        && requestedSeq !== undefined
        && surfaceNodeDescendsFrom(bySeq, seq, requestedSeq)
    })
  }
  if (targetSeq === undefined) {
    for (let index = surfaceNodes.length - 1; index >= 0; index -= 1) {
      const seq = surfaceNodes[index]
      if (!isUserMessage(seq)) continue
      if (targetText === '' || messageText(seq) === targetText) {
        targetSeq = seq
        break
      }
    }
  }
  if (targetSeq === undefined) return undefined
  const startIndex = surfaceNodes.indexOf(targetSeq)
  const endSeq = surfaceNodes.at(-1)
  if (startIndex < 0 || !Number.isSafeInteger(endSeq)) return undefined
  return {
    start: targetSeq,
    end: endSeq,
    sourceEventSeqs: surfaceNodes.slice(startIndex)
  }
}

/**
 * Resolve an ordinary Session through the same controller seam used by the
 * native `session.prompt` command.  A session can be visible in the sidebar
 * while its Agent has been evicted from the live map; asking only
 * `agents.get()` made edit requests fail with a misleading "session
 * unavailable" response in that case.  The controller returns
 * `{ agent }`/`{ error }` for cold-session resume, while older Harness builds
 * may expose the Agent directly, so accept both shapes.
 */
async function resolveOrdinaryAgent(ctx, sessionId) {
  const agents = getService(ctx, 'agents')
  const live = agents?.get?.(sessionId)
  if (live !== undefined) return live

  const controller = getService(ctx, 'sessionController')
  if (typeof controller?.resolveAgent !== 'function') return undefined
  try {
    const resolved = await controller.resolveAgent(sessionId)
    if (resolved?.agent !== undefined) return resolved.agent
    if (resolved?.session !== undefined) return resolved
  } catch {
    // Convert resume failures into the stable route-level 409 below.  The
    // controller already owns the detailed diagnostic and retry policy.
  }
  return undefined
}

/**
 * Arm one live ordinary Session for a single native prompt replacement.
 *
 * DSH's durable log is append-only, but its surface layer supports a
 * positional replacement event.  The normal `session.prompt` RPC always asks
 * AgentLoop to append a user/message with `surfaceOp: 'append'`; this narrow
 * one-shot wrapper changes only that next matching message to a replacement
 * and then restores the original method.  The browser therefore keeps the
 * same session id, native queue/echo semantics, and model-selection state.
 */
function createSessionEditRoute(ctx) {
  const armed = new Map()

  const restore = (record) => {
    if (record === undefined || record.restored) return
    record.restored = true
    if (record.timer !== undefined) clearTimeout(record.timer)
    if (record.session?.append === record.wrapper) record.session.append = record.original
    if (armed.get(record.sessionId) === record) armed.delete(record.sessionId)
  }

  const arm = (session, sessionId, range, targetText, editedText) => {
    restore(armed.get(sessionId))
    const original = session.append
    if (typeof original !== 'function') throw new SidechatModelError('unavailable', '当前会话不支持原地修改', 503)
    const record = {
      session,
      sessionId,
      original,
      range,
      targetText,
      editedText,
      restored: false,
      consumed: false,
      timer: undefined,
      wrapper: undefined
    }
    record.wrapper = function sessionEditAppend(type, data, ...opts) {
      const matches = !record.consumed
        && type === 'user/message'
        && data?.source?.kind === 'user'
        && (record.editedText === '' || textFromMessage(data) === record.editedText)
      if (!matches) return record.original.call(this, type, data, ...opts)

      const currentRange = sessionEditRange(session, record.range.start, record.targetText)
      if (currentRange === undefined) {
        restore(record)
        return record.original.call(this, type, data, ...opts)
      }
      record.consumed = true
      restore(record)
      return record.original.call(this, type, data, {
        surfaceOp: { op: 'replace', start: currentRange.start, end: currentRange.end },
        sourceEventSeqs: currentRange.sourceEventSeqs
      })
    }
    session.append = record.wrapper
    record.timer = setTimeout(() => restore(record), PENDING_SELECTION_TTL_MS)
    record.timer.unref?.()
    armed.set(sessionId, record)
  }

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
      const sessionId = requireField(payload, 'sessionId')
      const text = payload?.text
      if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_EDIT_TEXT_LENGTH) {
        throw new SidechatModelError('bad-request', 'missing or invalid "text"')
      }
      const targetText = typeof payload?.targetText === 'string' ? payload.targetText : ''
      if (targetText.length > MAX_EDIT_TEXT_LENGTH) {
        throw new SidechatModelError('bad-request', 'invalid "targetText"')
      }
      const rawStartSeq = payload?.startSeq
      if (rawStartSeq !== undefined && (!Number.isSafeInteger(rawStartSeq) || rawStartSeq < 0)) {
        throw new SidechatModelError('bad-request', 'invalid "startSeq"')
      }
      const agent = await resolveOrdinaryAgent(ctx, sessionId)
      const session = agent?.session
      if (agent === undefined || session === undefined) {
        throw new SidechatModelError('session-unavailable', '当前会话尚未加载，请先打开当前对话后重试', 409)
      }
      if (session.header?.origin === 'subagent') {
        throw new SidechatModelError('session-unavailable', '侧边子会话不支持修改主对话消息', 409)
      }
      if (agent.status === 'running') {
        throw new SidechatModelError('agent-busy', '当前会话仍在生成，请先停止后再修改', 409)
      }
      const range = sessionEditRange(session, rawStartSeq, targetText)
      if (range === undefined) {
        throw new SidechatModelError('message-not-found', '找不到要修改的用户消息，请刷新当前会话后重试', 404)
      }
      arm(session, sessionId, range, targetText, text)
      writeOk(res, { sessionId, armed: true })
    } catch (error) {
      writeError(res, error)
    }
  }

  return {
    handler,
    dispose() {
      for (const record of armed.values()) restore(record)
      armed.clear()
    }
  }
}

/**
 * Build the history page expected by Better Sidebar's native SideChatView.
 *
 * DSH Desktop 0.1.2 exposes the generic `session/page` RPC only for ordinary
 * sessions and catalogued subagents.  The sidechat children created by the
 * Better Sidebar 0.17.1 integration deliberately use a private
 * `subagent/descriptor`, so the current host rejects that RPC with
 * `subagent-catalog-diagnostic`.  The durable session-persistence seam is the
 * authoritative source for these children; wrapping its append-only events
 * as `{ event }` records gives the native transcript exactly the same shape
 * as the generic history API without forking its renderer.
 */
function createSidechatHistoryRoute(ctx) {
  const pageFor = (events, beforeSeq, maxMessages) => {
    const ordered = (Array.isArray(events) ? events : [])
      .filter((event) => event !== null && typeof event === 'object'
        && typeof event.type === 'string' && Number.isSafeInteger(event.seq))
      .sort((left, right) => left.seq - right.seq)
    let end = ordered.length
    if (beforeSeq !== undefined) {
      const firstAtOrAfter = ordered.findIndex((event) => event.seq >= beforeSeq)
      end = firstAtOrAfter < 0 ? ordered.length : firstAtOrAfter
    }
    let cut = 0
    let count = 0
    for (let index = end - 1; index >= 0; index -= 1) {
      const event = ordered[index]
      if (!HISTORY_MESSAGE_TYPES.has(event.type)) continue
      count += 1
      if (count >= maxMessages) {
        // A message can point at chunk/tool source events. Keep the complete
        // event range before the message so streaming/tool rows stay paired.
        const sourceSeqs = Array.isArray(event.sourceEventSeqs)
          ? event.sourceEventSeqs.filter((seq) => Number.isSafeInteger(seq))
          : []
        const groupStart = sourceSeqs.length > 0 ? Math.min(event.seq, ...sourceSeqs) : event.seq
        const groupIndex = ordered.findIndex((candidate) => candidate.seq >= groupStart)
        cut = groupIndex < 0 ? index : groupIndex
        break
      }
    }
    return {
      events: ordered.slice(cut, end).map((event) => ({ type: 'event', event })),
      hasMore: cut > 0
    }
  }

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
      // Better Sidebar's native SideChatView calls the shared history API
      // with `sessionId`; keep `childId` as a backwards-compatible alias for
      // older plugin clients and normalize both forms before validation.
      const childId = typeof payload?.childId === 'string' && payload.childId.trim() !== ''
        ? payload.childId
        : requireField(payload, 'sessionId')
      const child = await sidechatChildOf(ctx, childId)
      if (child === undefined) throw new SidechatModelError('not-found', '目标不是可用的 Better Sidebar 侧边会话', 404)

      const rawBeforeSeq = payload?.beforeSeq
      if (rawBeforeSeq !== undefined && (!Number.isSafeInteger(rawBeforeSeq) || rawBeforeSeq < 0)) {
        throw new SidechatModelError('bad-request', 'invalid "beforeSeq"')
      }
      const rawMaxMessages = payload?.maxMessages
      if (rawMaxMessages !== undefined
        && (!Number.isSafeInteger(rawMaxMessages) || rawMaxMessages <= 0)) {
        throw new SidechatModelError('bad-request', 'invalid "maxMessages"')
      }
      const maxMessages = Math.min(
        rawMaxMessages === undefined ? DEFAULT_HISTORY_MESSAGES : rawMaxMessages,
        MAX_HISTORY_MESSAGES,
      )

      let events = child.agent?.session?.events
      if (!Array.isArray(events)) {
        const persistence = getService(ctx, 'sessionPersistence')
        if (typeof persistence?.inspect !== 'function') {
          throw new SidechatModelError('unavailable', '当前 DSH 没有可用的会话历史服务', 503)
        }
        const inspected = await persistence.inspect(childId)
        events = inspected?.events
      }
      if (!Array.isArray(events)) {
        throw new SidechatModelError('unavailable', '侧边会话历史不可用', 503)
      }
      writeOk(res, pageFor(events, rawBeforeSeq, maxMessages))
    } catch (error) {
      writeError(res, error)
    }
  }

  return { handler }
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
    const controller = getService(ctx, 'sessionController')
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
      const llm = getService(ctx, 'llm')
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
      ctx?.logger?.warn?.('[dsh-harness-chat-control] webServer unavailable; sidechat host routes disabled')
      return undefined
    }
    const modelRoute = createSidechatModelRoute(ctx)
    const historyRoute = createSidechatHistoryRoute(ctx)
    const sessionEditRoute = createSessionEditRoute(ctx)
    let disposeModelRoute
    let disposeHistoryRoute
    let disposeSessionEditRoute
    try {
      disposeModelRoute = webServer.register({ kind: 'exact', path: MODEL_ROUTE, handler: modelRoute.handler })
      disposeHistoryRoute = webServer.register({ kind: 'exact', path: HISTORY_ROUTE, handler: historyRoute.handler })
      disposeSessionEditRoute = webServer.register({ kind: 'exact', path: SESSION_EDIT_ROUTE, handler: sessionEditRoute.handler })
    } catch (error) {
      try { disposeModelRoute?.() } finally {
        try { disposeHistoryRoute?.() } finally {
          try { disposeSessionEditRoute?.() } finally {
            modelRoute.dispose()
            sessionEditRoute.dispose()
          }
        }
      }
      throw error
    }
    return () => {
      try { disposeModelRoute?.() } finally {
        try { disposeHistoryRoute?.() } finally {
          try { disposeSessionEditRoute?.() } finally {
            modelRoute.dispose()
            sessionEditRoute.dispose()
          }
        }
      }
    }
  }
  if (typeof ctx?.effect === 'function') ctx.effect(registerRoute, 'dsh-harness-chat-control: sidechat host routes')
  else registerRoute()

  // Some packaged DSH Desktop builds keep the client-HMR event channel alive
  // but do not notice an installer replacing a live bundle through a junction.
  // Ask the authoritative client-module registry to reconcile this package
  // once after activation.  `rebuilt()` is content-hash based, so this is a
  // no-op when the bundle is already current; it only emits an HMR frame when
  // the bytes actually changed.  The delayed retry covers activation orders
  // where the registry row is populated just after this plugin's `apply()`.
  const refreshClientBundle = (label) => {
    let clientModules
    try {
      clientModules = ctx?.clientModules || getService(ctx, 'clientModules')
    } catch {
      clientModules = undefined
    }
    if (clientModules === undefined) return
    const errors = []
    try {
      // A running DSH keeps client-module metadata keyed by the loader tree's
      // base URL.  Generation installs replace the profile junction in place,
      // so that cache can still point at a retired generation even though the
      // loader now resolves the new package.  Drop only this package's cached
      // source/table rows, then let the registry rebuild them through its
      // normal reconciliation path.  This avoids mutating any old generation
      // file merely to make HMR notice an update.
      if (clientModules.pkgMeta?.entries && typeof clientModules.pkgMeta.delete === 'function') {
        for (const [key, value] of clientModules.pkgMeta.entries()) {
          if (key.endsWith(`\u0000${name}`) || value?.packageName === name) clientModules.pkgMeta.delete(key)
        }
      }
      if (clientModules.sources?.entries && typeof clientModules.sources.delete === 'function') {
        for (const [key, value] of clientModules.sources.entries()) {
          if (value?.packageName === name) clientModules.sources.delete(key)
        }
      }
      clientModules.table?.delete?.(name)

      // Reconcile a late-mounted package before asking for its content hash.
      if (clientModules.dirty?.add && typeof clientModules.flush === 'function') {
        clientModules.dirty.add(name)
        clientModules.flush((error) => errors.push(error instanceof Error ? error.message : String(error)))
      }
      const revision = typeof clientModules.rebuilt === 'function'
        ? clientModules.rebuilt(name)
        : undefined
      if (errors.length > 0 || revision === undefined) {
        ctx?.logger?.warn?.(`[dsh-harness-chat-control] client bundle refresh ${label} did not complete${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`)
      }
    } catch (error) {
      ctx?.logger?.warn?.(`[dsh-harness-chat-control] client bundle refresh ${label} failed: ${String(error)}`)
    }
  }
  const scheduleClientBundleRefresh = () => {
    queueMicrotask(() => refreshClientBundle('microtask'))
    const timer = setTimeout(() => refreshClientBundle('timer'), 250)
    timer.unref?.()
  }
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => {
      scheduleClientBundleRefresh()
    }, 'dsh-harness-chat-control: synchronize client bundle')
  } else {
    scheduleClientBundleRefresh()
  }

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
      clientModules = ctx?.clientModules || getService(ctx, 'clientModules')
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
