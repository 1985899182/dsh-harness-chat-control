import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')
const required = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'scripts/install.ps1',
  'scripts/install-generation.mjs',
  'README.md',
  'LICENSE'
]

for (const relative of required) {
  const absolute = resolve(root, relative)
  if (!existsSync(absolute)) throw new Error(`Missing required plugin file: ${relative}`)
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-harness-chat-control') throw new Error('Unexpected package name')
if (manifest.version !== '0.2.48') throw new Error(`Unexpected plugin version: ${manifest.version}`)
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Missing DSH bundle patch declaration')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('Missing DSH Web client declaration')
if (manifest.exports?.['./client']?.default !== './lib/client.js') throw new Error('Missing client export')
if (manifest.exports?.['./runtime']?.default !== './lib/index.js') throw new Error('Missing versioned runtime export')
if (manifest.exports?.['./package.json'] !== './package.json') throw new Error('Missing package manifest export for Desktop discovery')
if (!manifest.files?.includes('scripts')) throw new Error('The distributable package must include its installer')
if (manifest.engines?.node !== '>=20' || manifest.engines?.pnpm !== '>=10 <12') {
  throw new Error('The package must declare the supported Node.js and pnpm ranges')
}

const desktopClientDependencies = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-input-trigger'
]
if (JSON.stringify(manifest.dsh.client.inject) !== JSON.stringify(desktopClientDependencies)) {
  throw new Error('Client injection order does not match the DSH Desktop 0.1.2-alpha.1 contract')
}
if (manifest.peerDependencies?.['@deepseek-ai/dsh-client-runtime'] !== undefined) {
  throw new Error('The obsolete dsh-client-runtime dependency must not be declared')
}
if (manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-input-trigger'] !== '^0.1.2-alpha.1') {
  throw new Error('The native reference-chip input trigger dependency is missing')
}

const installerPath = resolve(root, 'scripts', 'install.ps1')
const installer = readFileSync(installerPath, 'utf8')
if (!installer.includes("$Repository = '1985899182/dsh-harness-chat-control'") || !installer.includes('$packageSpec = "github:$Repository#$Ref"')) {
  throw new Error('Installer must use the canonical GitHub package spec')
}
if (!installer.includes("[string]$Ref = 'v0.2.48'")) {
  throw new Error('Installer default ref must point at the published stable tag')
}
if (!installer.includes('dsh.profile.bundles')) {
  throw new Error('Installer must verify DSH bundle registration')
}
for (const phrase of [
  'dsh-market/installed',
  'dsh-market/toggle',
  'ConvertTo-LoopbackWebUri',
  'Invoke-DshMarketHotMount',
  'runningPluginWasLive',
  '为避免重复 Loader',
  '[string]$WebUrl',
  '[switch]$SkipLiveMount',
  'Get-ProfilePackageTarget',
  '--sync-live-client',
  '--previous-package-directory',
  '内置 HMR',
  '无需重启 DSH Desktop',
]) {
  if (!installer.includes(phrase)) throw new Error(`Installer is missing the live-install seam: ${phrase}`)
}
if (!readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8').includes('inject: [clientModules, webServer, webRuntime')) {
  throw new Error('Host patch must wait for the clientModules service before mounting')
}
if (!readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8').includes('webServer, webRuntime')) {
  throw new Error('Host patch must inject the web route services for sidechat model selection')
}
if (!readFileSync(resolve(root, 'README.md'), 'utf8').includes('scripts/install.ps1')) {
  throw new Error('README must document the one-command installer')
}
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
for (const phrase of ['1 条注释', 'dsh-better-sidebar@0.17.1', '侧边原生对话栏', '铅笔按钮', '卡死']) {
  if (!readme.includes(phrase)) throw new Error(`README is missing the native reference/sidechat note: ${phrase}`)
}
if (process.platform === 'win32') {
  const escapedInstallerPath = installerPath.replace(/'/g, "''")
  const parseCommand = [
    '$tokens = $null',
    '$parseErrors = $null',
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${escapedInstallerPath}', [ref]$tokens, [ref]$parseErrors)`,
    'if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Error $_ }; exit 1 }'
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parseCommand], { stdio: 'inherit' })
}

for (const relative of ['lib/index.js', 'lib/client.js']) {
  execFileSync(process.execPath, ['--check', resolve(root, relative)], { stdio: 'inherit' })
}
execFileSync(process.execPath, ['--check', resolve(root, 'scripts/install-generation.mjs')], { stdio: 'inherit' })

let registeredModule
const registrations = []
const injectedSlots = []
const insertedReferences = []
const registeredSources = []
const forkCalls = []
const childPrompts = []
const openedSessions = []
const fakeReact = {
  Fragment: Symbol('Fragment'),
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: (effect) => { effect?.() },
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
}

const browserSandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        registeredModule = definition
      }
    },
    getSelection: () => ({ toString: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: { appendChild: () => {} }
  },
  console
}

const clientSource = readFileSync(resolve(root, 'lib/client.js'), 'utf8')
const hostSource = readFileSync(resolve(root, 'lib/index.js'), 'utf8')
if ((clientSource.match(/function referencePreview\(text\)/gu) || []).length !== 1) {
  throw new Error('Reference preview helper must be defined once at client module scope')
}
if (!clientSource.includes("!classes.includes('sidechatComposerInput')")) {
  throw new Error('Sidechat composer selector must not treat the controlled textarea as its parent')
}
if (!clientSource.includes('queueObserverFlush') || !clientSource.includes('label.textContent !== preview')) {
  throw new Error('Sidechat reference bridge must coalesce mutations and update chip text idempotently')
}
if (!clientSource.includes("const chip = doc.createElement('div')")
  || !clientSource.includes('chip.append(remove)')
  || clientSource.includes('row.append(chip, remove)')) {
  throw new Error('Sidechat reference remove control must stay inside the same capsule')
}
if (!clientSource.includes('[class*="sidechatComposer"][data-dsh-harness-model] [class*="sidechatComposerMeta"]')) {
  throw new Error('Native sidechat model badge must be hidden when the plugin selector is mounted')
}
if (!clientSource.includes("const SIDECHAT_MODEL_ROUTE = '/dsh-harness-chat-control/sidechat-model'")) {
  throw new Error('Sidechat model selector route is missing')
}
if (!clientSource.includes("const SIDECHAT_PERMISSION_ROUTE = '/dsh-harness-chat-control/sidechat-permission'")) {
  throw new Error('Sidechat permission selector route is missing')
}
if (!clientSource.includes("const SIDECHAT_HISTORY_ROUTE = '/dsh-harness-chat-control/sidechat-history'")) {
  throw new Error('Sidechat history compatibility route is missing')
}
if (!clientSource.includes('modelCatalog()') || !clientSource.includes('_2WBGbq_trigger')) {
  throw new Error('Sidechat model catalog selector is missing')
}
if (!clientSource.includes('overlaySnapshot') || !clientSource.includes('useSyncExternalStore')) {
  throw new Error('Sidechat model directory must cache its overlay snapshot for React stability')
}
for (const phrase of ['dshhc-sidechat-composer-controls', 'JyqXLa_card', 'JyqXLa_row', 'JyqXLa_tools', 'JyqXLa_modes', 'JyqXLa_trailing', 'JyqXLa_add', 'Q58mYq_trigger', '_2WBGbq_trigger', '_2WBGbq_menu', 'refreshSidechatAfterSend', 'refreshSidechatView', 'updateTab', 'Promise.allSettled']) {
  if (!clientSource.includes(phrase)) throw new Error(`Native sidechat composer control is missing: ${phrase}`)
}
for (const phrase of ['createSideChatDraftStore', 'SidechatComposer', 'installSidechatComposer', 'dshhc-sidechat-view', 'dshhc-sidechat-native-view [class*="sidechatComposer"]', "callSidebarApi('sidechat.prompt'", "callSidebarApi('sidechat.cancel'"]) {
  if (!clientSource.includes(phrase)) throw new Error(`React sidechat composer seam is missing: ${phrase}`)
}
for (const phrase of ['NativeSidechatComposer', 'conversation.composer.bar', 'resolveNativeSessionBinding', 'data-dsh-harness-native-inputbar', 'new Proxy(target', 'useNativeSource']) {
  if (!clientSource.includes(phrase)) throw new Error(`The sidechat must reuse the native InputBar seam: ${phrase}`)
}
if (clientSource.includes('sideChatModels.start()')) throw new Error('The obsolete DOM-mutating sidechat model controller is still active')
if (clientSource.includes('stopImmediatePropagation')) throw new Error('Sidechat interception must not freeze the host event loop')
if (!clientSource.includes('return [serializeReferenceText(cleanReference), cleanQuestion]')) {
  throw new Error('Sidechat quote must not manufacture a visible question')
}
if (clientSource.includes('function quoteLines') || clientSource.includes(".map((line) => `> ${line}`")) {
  throw new Error('Quote serialization must not manufacture Markdown blockquotes')
}
for (const phrase of ['REFERENCE_CONTEXT_HEADER', 'REFERENCE_CONTEXT_START', 'REFERENCE_CONTEXT_END', 'REFERENCE_TOKEN_PATTERN', 'normalizeReferenceDraft', 'detectLength', '【引用开始】', '【引用结束】']) {
  if (!clientSource.includes(phrase)) throw new Error(`Plain-text quote boundary is missing: ${phrase}`)
}
if (!hostSource.includes("const MODEL_ROUTE = '/dsh-harness-chat-control/sidechat-model'")
  || !hostSource.includes('selectForNextRequest')
  || !hostSource.includes('trustedRequest')) {
  throw new Error('Host sidechat model route validation/selection seam is missing')
}
if (!hostSource.includes("const PERMISSION_ROUTE = '/dsh-harness-chat-control/sidechat-permission'")
  || !hostSource.includes('permissionPresets')
  || !hostSource.includes('commands.execute')
  || !hostSource.includes('permission/preset')) {
  throw new Error('Host sidechat permission route validation/selection seam is missing')
}
if (!hostSource.includes("const HISTORY_ROUTE = '/dsh-harness-chat-control/sidechat-history'")
  || !hostSource.includes('sessionPersistence')
  || !hostSource.includes('createSidechatHistoryRoute')) {
  throw new Error('Host sidechat history compatibility route is missing')
}
if (!hostSource.includes("typeof payload?.childId === 'string'")
  || !hostSource.includes("requireField(payload, 'sessionId')")) {
  throw new Error('Host sidechat history route must accept the native sessionId payload')
}
for (const phrase of ['dshhc-message-edit', '编辑消息', 'data-composer-input', 'target.submit', 'inputActions', 'keyboard', 'replaceSession', 'sessions.fork']) {
  if (!clientSource.includes(phrase)) throw new Error(`Native composer edit seam is missing: ${phrase}`)
}
for (const phrase of ['dshhc-revision-card', '上一条提问', 'dshhc-revision-editor']) {
  if (clientSource.includes(phrase)) throw new Error(`The obsolete standalone revision UI remains: ${phrase}`)
}
for (const label of ['添加到对话', '更多详情', '在侧边聊天中提问']) {
  if (!clientSource.includes(label)) throw new Error(`Selection toolbar label is missing: ${label}`)
}

vm.runInNewContext(readFileSync(resolve(root, 'lib/client.js'), 'utf8'), browserSandbox, {
  filename: 'lib/client.js'
})

if (registeredModule?.id !== 'dsh-harness-chat-control') throw new Error('Client loader registration failed')
const clientPlugin = registeredModule.factory((specifier) => {
  if (specifier === 'react') return fakeReact
  throw new Error(`Unexpected client dependency: ${specifier}`)
})

const fakeSlots = {
  inject(name, callback) {
    injectedSlots.push(name)
    return callback()
  },
  register(config, component) {
    registrations.push({ config, component })
    return () => {}
  }
}

let fakeInputSnapshot = { draft: '已有草稿', draftRev: 7 }
const fakeInput = {
  state: {
    getSnapshot: () => fakeInputSnapshot
  }
}
const fakeConversation = {
  input: {
    for: () => fakeInput
  }
}
const fakeSessionContext = {
  get(name) {
    return name === 'conversation' ? fakeConversation : undefined
  },
  bail: (_actx, event, payload) => {
    if (event !== 'slash/input-insert-reference') return false
    insertedReferences.push({ outcome: { insert: payload.reference }, span: payload.span })
    return true
  }
}
const fakeInputTriggers = {
  registerSource(source) {
    registeredSources.push(source)
    return () => {}
  },
  sessionOf: () => ({
    execute(outcome, span) {
      insertedReferences.push({ outcome, span })
      return true
    }
  })
}

const fakeSessionsById = new Map()
const sourceSession = {
  sessionId: 'desktop-session-1',
  getSnapshot: () => ({ running: false })
}
fakeSessionsById.set('desktop-session-1', { session: sourceSession })

clientPlugin.apply({
  slots: fakeSlots,
  sessions: {
    binding: (id) => fakeSessionsById.get(String(id)),
    fork: async ({ atSeq }) => {
      forkCalls.push(atSeq)
      const child = {
        sessionId: 'desktop-session-2',
        getSnapshot: () => ({ running: false }),
        prompt: async (content) => {
          childPrompts.push(content)
          return { ok: true }
        }
      }
      fakeSessionsById.set('desktop-session-2', { session: child })
      return 'desktop-session-2'
    },
    create: async () => 'desktop-session-2',
    open: (id) => openedSessions.push(String(id)),
    list: { getSnapshot: () => ({ byId: { 'desktop-session-1': { cwd: 'D:/Study' } } }) },
    scope: () => fakeSessionContext
  },
  effect(callback) {
    return callback()
  },
  get(name) {
    if (name === 'inputTriggers') return fakeInputTriggers
    if (name === 'conversation') return fakeConversation
    return undefined
  }
})

const expectedSlots = [
  'conversation.chat.assistant-actions',
  'conversation.input.dock',
  'sidebar.footer.action',
  'shell.overlay'
]
if (JSON.stringify(injectedSlots) !== JSON.stringify(expectedSlots)) {
  throw new Error(`Unexpected injected slots: ${JSON.stringify(injectedSlots)}`)
}
if (registrations.length !== expectedSlots.length) throw new Error('Expected four UI registrations')
if (!registrations.every(({ config }) => typeof config.id === 'string' && typeof config.inject === 'function')) {
  throw new Error('Every UI registration must have a stable id and injection factory')
}

const desktopChatSnapshot = {
  nodes: new Map([
    ['previous-tail', {
      key: 'previous-tail',
      kind: 'turn-tail',
      anchorSeq: 42,
      location: { kind: 'turn', turn: { turn: 1, end: { seq: 42 } } },
      data: { closing: { finalNode: { seq: 42 }, blocks: [] } }
    }],
    ['prompt', {
      key: 'prompt',
      kind: 'user',
      anchorSeq: 50,
      location: { kind: 'turn', turn: { turn: 2 } },
      data: { content: [{ type: 'text', text: '请把答案改短一些' }] }
    }],
    ['answer', {
      kind: 'assistant-step',
      data: {
        finalNode: { messageId: 'desktop-answer-1' },
        blocks: [{ kind: 'text', text: '这是 DSH Desktop 的回答。' }]
      }
    }]
  ])
}

// The current DSH Desktop TurnTailNodeView passes the completed answer as
// `node.data.closing.blocks`; `closing.finalNode` only carries message identity.
const desktopTurnTailSnapshot = {
  nodes: new Map([
    ['tail', {
      kind: 'turn-tail',
      data: {
        closing: {
          finalNode: { messageId: 'desktop-tail-answer-1', seq: 42 },
          blocks: [{ kind: 'text', text: '这是 TurnTail 中的 DSH Desktop 回答。' }]
        }
      }
    }]
  ])
}

const quoteRegistration = registrations.find(({ config }) => config.id === 'harness-quote-actions')
const revisionRegistration = registrations.find(({ config }) => config.id === 'harness-revision')
const shellRegistration = registrations.find(({ config }) => config.id === 'harness-selection-toolbar')
if (quoteRegistration === undefined || revisionRegistration === undefined) {
  throw new Error('Required Desktop UI registrations are missing')
}
if (shellRegistration === undefined) throw new Error('Selection toolbar shell registration is missing')
if (registeredSources.length !== 1 || registeredSources[0].name !== 'dsh-harness-chat-control') {
  throw new Error('The native annotation reference source was not registered')
}

const quoteProps = quoteRegistration.config.inject('desktop-session-1')
const sideCalls = []
const quoteView = quoteRegistration.component({
  ...quoteProps,
  messageId: 'desktop-answer-1',
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select({ draft: '' }),
  inputActions: { setDraft: () => {} },
  openSideChat: (...args) => sideCalls.push(args)
})
if (quoteView === null) throw new Error('Assistant action cannot read the DSH Desktop chat snapshot')
quoteView.args[2].args[1].onClick({})
if (insertedReferences.length !== 1) throw new Error('Assistant quote did not insert one native reference chip')
const inserted = insertedReferences[0]
const reference = inserted.outcome?.insert
if (reference?.source !== 'dsh-harness-chat-control'
  || reference?.label !== '1 条注释'
  || reference?.appearance !== 'session'
  || inserted.span?.draftRev !== 7
  || inserted.span?.start !== 4
  || inserted.span?.end !== 4) {
  throw new Error(`Assistant quote did not produce the expected atomic reference: ${JSON.stringify(inserted)}`)
}
const serialized = await registeredSources[0].codec.serialize(reference.ref)
if (!serialized.includes('这是 DSH Desktop 的回答。')) throw new Error('Reference serializer lost the selected answer')
if (serialized.includes('\n---\n') || /(?:^|\n)>\s/u.test(serialized)) {
  throw new Error('Reference serializer must not add Markdown separators or blockquotes')
}
if (!serialized.includes('【引用开始】') || !serialized.includes('【引用结束】')) {
  throw new Error('Reference serializer must keep plain-text context boundaries')
}
if (registeredSources[0].codec.clipboardText(reference.ref) !== '@[1 条注释](dsh-chat-control:' + JSON.parse(reference.ref).id + ')') {
  throw new Error('Reference clipboard projection is not stable')
}

// A native chip is one character in DSH's detect projection but expands to a
// longer clipboard token in `input.draft`.  A second quote must therefore use
// the logical detect offset, otherwise the host rejects the span and a legacy
// bridge can leak the clipboard token into the user message.
const firstClipboard = registeredSources[0].codec.clipboardText(reference.ref)
fakeInputSnapshot = {
  draft: `已有草稿 ${firstClipboard}`,
  draftRev: 8,
  occurrences: [{ offset: 5, length: firstClipboard.length }]
}
const secondQuoteView = quoteRegistration.component({
  ...quoteProps,
  messageId: 'desktop-answer-1',
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select({ draft: '' }),
  inputActions: { setDraft: () => {} },
  openSideChat: (...args) => sideCalls.push(args)
})
secondQuoteView.args[2].args[1].onClick({})
const secondInserted = insertedReferences.at(-1)
if (secondInserted?.span?.start !== 6 || secondInserted?.span?.end !== 6 || secondInserted?.span?.draftRev !== 8) {
  throw new Error(`Reference insertion did not fold clipboard offsets to the native detect projection: ${JSON.stringify(secondInserted)}`)
}

const tailQuoteView = quoteRegistration.component({
  ...quoteProps,
  messageId: 'desktop-tail-answer-1',
  useChat: (select) => select(desktopTurnTailSnapshot),
  useInput: (select) => select({ draft: '' }),
  inputActions: { setDraft: () => {} },
  openSideChat: (...args) => sideCalls.push(args)
})
if (tailQuoteView === null) throw new Error('Assistant action cannot read the current TurnTail snapshot')

let nativeDraft = ''
const nativeInputActions = {
  setDraft: (text) => { nativeDraft = text },
  submit: () => {}
}
const revisionProps = revisionRegistration.config.inject('desktop-session-1')
let normalizedLegacyDraft = ''
let legacySubmitted = ''
const legacyInputActions = {
  setDraft: (text) => { normalizedLegacyDraft = text },
  submit: () => { legacySubmitted = normalizedLegacyDraft }
}
fakeInputSnapshot = { draft: firstClipboard, draftRev: 9, occurrences: [] }
revisionRegistration.component({
  ...revisionProps,
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select(fakeInputSnapshot),
  inputActions: legacyInputActions
})
legacyInputActions.submit()
if (!legacySubmitted.includes('【引用开始】') || legacySubmitted.includes('dsh-chat-control:')) {
  throw new Error(`Persisted reference token was sent as raw text instead of serialized context: ${JSON.stringify(legacySubmitted)}`)
}

revisionProps.revisionStore.request({
  sessionId: 'desktop-session-1',
  key: 'prompt',
  text: '请把答案改短一些'
})
const revisionView = revisionRegistration.component({
  ...revisionProps,
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select({ draft: nativeDraft }),
  inputActions: nativeInputActions
})
if (revisionView !== null) throw new Error('Revision dock must not render a standalone edit card')
if (nativeDraft !== '请把答案改短一些') throw new Error('Edit request did not seed the native composer draft')
nativeDraft = '修改后的消息'
revisionRegistration.component({
  ...revisionProps,
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select({ draft: nativeDraft }),
  inputActions: nativeInputActions
})
nativeInputActions.submit()
await new Promise((resolve) => setTimeout(resolve, 0))
if (forkCalls[0] !== 42) throw new Error(`Revision fork was not cut at the previous turn end: ${JSON.stringify(forkCalls)}`)
if (childPrompts[0]?.[0]?.text !== '修改后的消息') throw new Error('Edited draft was not sent to the replacement session')
if (openedSessions.at(-1) !== 'desktop-session-2') throw new Error('Replacement session was not opened after send')
if (revisionProps.revisionStore.getSnapshot().pending !== null) throw new Error('Revision state was not cleared after replacement send')

const shellProps = shellRegistration.config.inject()
const selectionStore = shellProps.selectionStore
const shellRevisionBeforeRequest = shellProps.revisionStore?.getSnapshot?.().revision
if (shellProps.revisionStore.request({ sessionId: 'desktop-session-1', key: 'prompt', text: '待修改消息' }) === null) {
  throw new Error('ChatGPT-style edit request was rejected')
}
if (shellProps.revisionStore.getSnapshot().revision !== shellRevisionBeforeRequest + 1 || shellProps.revisionStore.getSnapshot().pending?.text !== '待修改消息') {
  throw new Error('ChatGPT-style edit request did not publish a pending native-composer edit')
}
const referenceCalls = []
selectionStore.show({
  text: '选中的回答片段',
  sessionId: 'desktop-session-1',
  rect: { left: 240, top: 80, width: 100, height: 20, right: 290, bottom: 100 },
  placement: 'above'
})
const shellView = shellRegistration.component({
  ...shellProps,
  insertReference: (...args) => referenceCalls.push(args),
  openSideChat: (...args) => sideCalls.push(args),
  useSessions: (select) => select({ current: 'desktop-session-1' })
})
const shellChildren = shellView?.args?.slice(2) || []
const selectionChild = shellChildren.find((child) => child?.args?.[0]?.name === 'SelectionToolbar')
if (selectionChild === undefined) throw new Error('Selection toolbar is not mounted in shell overlay')
if (!shellChildren.some((child) => child?.args?.[0]?.name === 'UserEditOverlay')) {
  throw new Error('ChatGPT-style user edit overlay is not mounted in shell overlay')
}
const selectionView = selectionChild.args[0](selectionChild.args[1])
const toolbar = selectionView?.args?.[2]
const buttons = toolbar?.args?.slice(2) || []
if (buttons.length !== 3) throw new Error('Selection toolbar must expose three actions')
buttons[0].args[1].onClick({})
if (referenceCalls.length !== 1 || referenceCalls[0][0] !== 'desktop-session-1' || referenceCalls[0][1] !== '选中的回答片段') {
  throw new Error('Selection toolbar did not request an atomic reference insertion')
}

selectionStore.show({
  text: '需要解释的片段',
  sessionId: 'desktop-session-1',
  rect: { left: 240, top: 80, width: 100, height: 20, right: 290, bottom: 100 },
  placement: 'above'
})
const detailView = selectionChild.args[0](selectionChild.args[1])
const detailButtons = detailView.args[2].args.slice(2)
detailButtons[1].args[1].onClick({})
if (sideCalls.at(-1)?.[0] !== 'desktop-session-1' || sideCalls.at(-1)?.[1] !== '需要解释的片段' || sideCalls.at(-1)?.[2] !== '') {
  throw new Error('The details action did not open native sidechat with an empty editable question')
}

selectionStore.show({
  text: '需要带入侧边聊天的片段',
  sessionId: 'desktop-session-1',
  rect: { left: 240, top: 80, width: 100, height: 20, right: 290, bottom: 100 },
  placement: 'above'
})
const sideView = selectionChild.args[0](selectionChild.args[1])
const sideButtons = sideView.args[2].args.slice(2)
sideButtons[2].args[1].onClick({})
if (sideCalls.at(-1)?.[0] !== 'desktop-session-1' || sideCalls.at(-1)?.[1] !== '需要带入侧边聊天的片段' || sideCalls.at(-1)?.[2] !== '') {
  throw new Error('The side-chat action did not carry the selected text with an empty editable question')
}

console.log('dsh-harness-chat-control: static and loader validation passed')
