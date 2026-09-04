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
if (manifest.version !== '0.2.20') throw new Error(`Unexpected plugin version: ${manifest.version}`)
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Missing DSH bundle patch declaration')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('Missing DSH Web client declaration')
if (manifest.exports?.['./client']?.default !== './lib/client.js') throw new Error('Missing client export')
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
if (!installer.includes("[string]$Ref = 'v0.2.20'")) {
  throw new Error('Installer default ref must point at the published stable tag')
}
if (!installer.includes('dsh.profile.bundles')) {
  throw new Error('Installer must verify DSH bundle registration')
}
if (!readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8').includes('inject: [clientModules]')) {
  throw new Error('Host patch must wait for the clientModules service before mounting')
}
if (!readFileSync(resolve(root, 'README.md'), 'utf8').includes('scripts/install.ps1')) {
  throw new Error('README must document the one-command installer')
}
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
for (const phrase of ['1 条注释', 'dsh-better-sidebar@0.17.1', '侧边原生 composer', '铅笔按钮', '卡死']) {
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
const fakeReact = {
  Fragment: Symbol('Fragment'),
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
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
if (!clientSource.includes("!classes.includes('sidechatComposerInput')")) {
  throw new Error('Sidechat composer selector must not treat the controlled textarea as its parent')
}
if (!clientSource.includes('queueObserverFlush') || !clientSource.includes('label.textContent !== preview')) {
  throw new Error('Sidechat reference bridge must coalesce mutations and update chip text idempotently')
}
if (!clientSource.includes('dshhc-message-edit') || !clientSource.includes('编辑并重新发送')) {
  throw new Error('ChatGPT-style user message edit affordance is missing')
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

const fakeInput = {
  state: {
    getSnapshot: () => ({ draft: '已有草稿', draftRev: 7 })
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

clientPlugin.apply({
  slots: fakeSlots,
  sessions: {
    binding: () => undefined,
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
    ['prompt', {
      kind: 'user',
      anchorSeq: 41,
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
if (registeredSources[0].codec.clipboardText(reference.ref) !== '@[1 条注释](dsh-chat-control:' + JSON.parse(reference.ref).id + ')') {
  throw new Error('Reference clipboard projection is not stable')
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

const revisionView = revisionRegistration.component({
  useChat: (select) => select(desktopChatSnapshot),
  useSession: (select) => select({ running: false }),
  replay: async () => {},
  stop: async () => {}
})
if (revisionView === null) throw new Error('Revision dock cannot read the DSH Desktop chat snapshot')

const shellProps = shellRegistration.config.inject()
const selectionStore = shellProps.selectionStore
if (shellProps.revisionStore?.getSnapshot?.().revision !== 0) throw new Error('Revision request store did not start at revision zero')
shellProps.revisionStore.request()
if (shellProps.revisionStore.getSnapshot().revision !== 1) throw new Error('ChatGPT-style edit request did not publish a revision')
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
if (sideCalls.at(-1)?.[0] !== 'desktop-session-1' || sideCalls.at(-1)?.[1] !== '需要解释的片段' || !sideCalls.at(-1)?.[2].includes('详细解释')) {
  throw new Error('The details action did not open native sidechat with contextual prompt')
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
if (sideCalls.at(-1)?.[0] !== 'desktop-session-1' || sideCalls.at(-1)?.[1] !== '需要带入侧边聊天的片段' || !sideCalls.at(-1)?.[2].includes('最重要的结论')) {
  throw new Error('The side-chat action did not carry the selected text to native sidechat')
}

console.log('dsh-harness-chat-control: static and loader validation passed')
