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
  'README.md',
  'LICENSE'
]

for (const relative of required) {
  const absolute = resolve(root, relative)
  if (!existsSync(absolute)) throw new Error(`Missing required plugin file: ${relative}`)
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-harness-chat-control') throw new Error('Unexpected package name')
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Missing DSH bundle patch declaration')
if (manifest.dsh?.client?.platform !== 'web') throw new Error('Missing DSH Web client declaration')
if (manifest.exports?.['./client']?.default !== './lib/client.js') throw new Error('Missing client export')
if (!manifest.files?.includes('scripts')) throw new Error('The distributable package must include its installer')
if (manifest.engines?.node !== '>=20' || manifest.engines?.pnpm !== '>=10 <12') {
  throw new Error('The package must declare the supported Node.js and pnpm ranges')
}

const desktopClientDependencies = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-conversation'
]
if (JSON.stringify(manifest.dsh.client.inject) !== JSON.stringify(desktopClientDependencies)) {
  throw new Error('Client injection order does not match the DSH Desktop 0.1.2-alpha.1 contract')
}
if (manifest.peerDependencies?.['@deepseek-ai/dsh-client-runtime'] !== undefined) {
  throw new Error('The obsolete dsh-client-runtime dependency must not be declared')
}

const installerPath = resolve(root, 'scripts', 'install.ps1')
const installer = readFileSync(installerPath, 'utf8')
if (!installer.includes("$Repository = '1985899182/dsh-harness-chat-control'") || !installer.includes('$packageSpec = "github:$Repository#$Ref"')) {
  throw new Error('Installer must use the canonical GitHub package spec')
}
if (!installer.includes('dsh.profile.bundles')) {
  throw new Error('Installer must verify DSH bundle registration')
}
if (!readFileSync(resolve(root, 'README.md'), 'utf8').includes('scripts/install.ps1')) {
  throw new Error('README must document the one-command installer')
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

let registeredModule
const registrations = []
const injectedSlots = []
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

clientPlugin.apply({
  slots: fakeSlots,
  sessions: { binding: () => undefined }
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

const quoteRegistration = registrations.find(({ config }) => config.id === 'harness-quote-actions')
const revisionRegistration = registrations.find(({ config }) => config.id === 'harness-revision')
if (quoteRegistration === undefined || revisionRegistration === undefined) {
  throw new Error('Required Desktop UI registrations are missing')
}

const quoteView = quoteRegistration.component({
  messageId: 'desktop-answer-1',
  useChat: (select) => select(desktopChatSnapshot),
  useInput: (select) => select({ draft: '' }),
  inputActions: { setDraft: () => {} },
  openSide: () => {}
})
if (quoteView === null) throw new Error('Assistant action cannot read the DSH Desktop chat snapshot')

const revisionView = revisionRegistration.component({
  useChat: (select) => select(desktopChatSnapshot),
  useSession: (select) => select({ running: false }),
  replay: async () => {},
  stop: async () => {}
})
if (revisionView === null) throw new Error('Revision dock cannot read the DSH Desktop chat snapshot')

console.log('dsh-harness-chat-control: static and loader validation passed')
