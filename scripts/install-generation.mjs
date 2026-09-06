#!/usr/bin/env node
/**
 * Install this GitHub plugin through DSH Desktop's generation-aware boundary.
 *
 * DSH Desktop keeps community plugins in immutable generations.  The normal
 * `dsh plugin add` command writes to the shared profile tree, which is still
 * visible to the market but is not always discoverable by the packaged client
 * module loader.  This small bridge uses the public generation installer that
 * ships with DSH Desktop, then publishes the generation for the next launch.
 */

import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isAbsolute, join, relative, resolve } from 'node:path'

const PLUGIN_NAME = 'dsh-harness-chat-control'
const DEFAULT_REPOSITORY = '1985899182/dsh-harness-chat-control'
const DEFAULT_PROFILE = 'web'
const DEFAULT_DESKTOP_ROOT = 'D:\\DSH\\DSH Desktop'

function parseArgs(argv) {
  const options = {
    repository: DEFAULT_REPOSITORY,
    profile: DEFAULT_PROFILE,
    desktopRoot: process.env.DSH_DESKTOP_ROOT || DEFAULT_DESKTOP_ROOT,
    ref: 'v0.2.47',
    sourceDirectory: undefined,
    syncLiveClient: false,
    previousPackageDirectory: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const key = argument.slice(2)
    if (key === 'sync-live-client') {
      options.syncLiveClient = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    index += 1
    if (key === 'repository') options.repository = value
    else if (key === 'profile') options.profile = value
    else if (key === 'desktop-root') options.desktopRoot = value
    else if (key === 'ref') options.ref = value
    else if (key === 'source-directory') options.sourceDirectory = resolve(value)
    else if (key === 'previous-package-directory') options.previousPackageDirectory = resolve(value)
    else throw new Error(`Unknown option: --${key}`)
  }
  if (options.syncLiveClient && options.previousPackageDirectory === undefined) {
    throw new Error('--sync-live-client requires --previous-package-directory')
  }
  if (!options.syncLiveClient && options.previousPackageDirectory !== undefined) {
    throw new Error('--previous-package-directory requires --sync-live-client')
  }
  return options
}

function assertSafe(value, label, pattern) {
  if (!pattern.test(value)) throw new Error(`${label} is not safe: ${value}`)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function isInsideDirectory(parent, candidate) {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function resolveExportTarget(manifest, packageDirectory, exportName) {
  const entry = manifest.exports?.[exportName]
  const target = typeof entry === 'string'
    ? entry
    : entry?.default ?? entry?.import ?? entry?.require
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`${exportName} must resolve to a relative package file`)
  }
  const resolved = resolve(packageDirectory, target)
  if (!isInsideDirectory(packageDirectory, resolved)) {
    throw new Error(`${exportName} resolves outside the package directory`)
  }
  return resolved
}

async function synchronizeLiveClient({ dshHome, generationDirectory, previousPackageDirectory }) {
  const liveGenerationsDirectory = resolve(dshHome, 'profiles', '.generations', 'live')
  const previousDirectory = resolve(previousPackageDirectory)
  if (!isInsideDirectory(liveGenerationsDirectory, previousDirectory)) {
    throw new Error(`Previous package directory is outside DSH live generations: ${previousDirectory}`)
  }

  const newPackageDirectory = resolve(generationDirectory, 'node_modules', PLUGIN_NAME)
  const newManifest = await readJson(join(newPackageDirectory, 'package.json'))
  const previousManifest = await readJson(join(previousDirectory, 'package.json'))
  if (newManifest.name !== PLUGIN_NAME || previousManifest.name !== PLUGIN_NAME) {
    throw new Error('Live client synchronization refused: package name does not match the plugin')
  }

  const newClientPath = resolveExportTarget(newManifest, newPackageDirectory, './client')
  const previousClientPath = resolveExportTarget(previousManifest, previousDirectory, './client')
  if (!existsSync(newClientPath)) throw new Error(`New client artifact is missing: ${newClientPath}`)
  if (!existsSync(previousClientPath)) throw new Error(`Running client artifact is missing: ${previousClientPath}`)

  // ClientModuleRegistry watches the path loaded at process start.  Updating
  // only this browser artifact lets DSH's built-in HMR notice the new bytes;
  // the host patch remains in the newly projected generation for the next
  // process start, so we never mix host code into the running generation.
  await copyFile(newClientPath, previousClientPath)
  return { source: newClientPath, target: previousClientPath }
}

const options = parseArgs(process.argv.slice(2))
assertSafe(options.profile, 'profile', /^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
assertSafe(options.ref, 'ref', /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
assertSafe(options.repository, 'repository', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)

const desktopRoot = resolve(options.desktopRoot)
if (options.sourceDirectory !== undefined && !existsSync(options.sourceDirectory)) {
  throw new Error(`Local source directory not found: ${options.sourceDirectory}`)
}
const desktopModulePath = join(
  desktopRoot,
  'resources',
  'app',
  'node_modules',
  'dsh-desktop-market-installer',
  'index.js',
)
const generationInstallerPath = join(
  desktopRoot,
  'resources',
  'app',
  'node_modules',
  'dsh-desktop-market-installer',
  'generations',
  'installer.mjs',
)
const generationProjectionPath = join(
  desktopRoot,
  'resources',
  'app',
  'node_modules',
  'dsh-desktop-market-installer',
  'generations',
  'projection.mjs',
)
const generationRegistryPath = join(
  desktopRoot,
  'resources',
  'app',
  'node_modules',
  'dsh-desktop-market-installer',
  'generations',
  'registry.mjs',
)
const nodePath = join(
  desktopRoot,
  'resources',
  'app',
  'node_modules',
  'node',
  'bin',
  'node.exe',
)
if (!existsSync(desktopModulePath)) {
  throw new Error(`DSH Desktop generation installer not found: ${desktopModulePath}`)
}
if (!existsSync(nodePath)) throw new Error(`DSH Desktop bundled Node not found: ${nodePath}`)

const desktopModuleUrl = pathToFileURL(desktopModulePath).href
const [desktopEntry, generationInstaller, generationProjection, generationRegistry] = await Promise.all([
  import(desktopModuleUrl),
  import(pathToFileURL(generationInstallerPath).href),
  import(pathToFileURL(generationProjectionPath).href),
  import(pathToFileURL(generationRegistryPath).href),
])
const desktop = {
  ...desktopEntry,
  ...generationInstaller,
  ...generationProjection,
  ...generationRegistry,
}
const required = [
  'exposeMissingGenerationLinks',
  'installGeneration',
  'listGenerations',
  'projectGenerations',
  'publishGenerationManifest',
  'readDesired',
  'resolvePnpmEntry',
  'withRegistryLock',
  'writeDesired',
]
for (const name of required) {
  if (typeof desktop[name] !== 'function') {
    throw new Error(`This DSH Desktop build does not expose ${name}()`)
  }
}

const appData = process.env.APPDATA
if (!appData) throw new Error('APPDATA is not available; cannot locate DSH Desktop Harness home.')
const dshHome = join(appData, 'dsh-desktop', 'harness')
const pluginSpec = `github:${options.repository}#${options.ref}`
const profileDir = join(dshHome, 'profiles', options.profile)
const profileManifestPath = join(profileDir, 'package.json')

console.log(`DSH Desktop: ${desktopRoot}`)
console.log(`Harness home: ${dshHome}`)
console.log(`Profile: ${options.profile}`)
console.log(`Plugin source: ${pluginSpec}`)
if (options.sourceDirectory !== undefined) console.log(`Local source overlay: ${options.sourceDirectory}`)

const result = await desktop.withRegistryLock(dshHome, async () => {
  const install = await desktop.installGeneration({
    dshHome,
    profile: options.profile,
    pluginSpec,
    sourceSpec: pluginSpec,
    ...(options.sourceDirectory === undefined ? {} : { sourceDirectory: options.sourceDirectory }),
    expectedPluginName: PLUGIN_NAME,
    nodeExecutablePath: nodePath,
    pnpmEntryPath: desktop.resolvePnpmEntry(desktopModuleUrl),
    environment: process.env,
    onTrace: (line) => console.log(line),
    onOutput: (chunk) => process.stdout.write(chunk),
  })
  if (!install.ok) throw new Error(install.detail || 'generation install failed')

  const [desired, generations] = await Promise.all([
    desktop.readDesired(dshHome),
    desktop.listGenerations(dshHome),
  ])
  const byId = new Map(generations.map((generation) => [generation.id, generation]))
  const kept = desired.filter((id) => byId.get(id)?.pluginName !== PLUGIN_NAME)
  await desktop.writeDesired(dshHome, [...kept, install.generation.id])

  // The app must be closed for an existing profile directory to be replaced.
  // exposeMissingGenerationLinks only creates a missing link; the next cold
  // start runs the full safe projection and atomically replaces old entries.
  const exposed = await desktop.exposeMissingGenerationLinks(dshHome, options.profile)
  const published = await desktop.publishGenerationManifest(dshHome, options.profile)
  // The one-click installer requires DSH Desktop to be fully closed.  Project
  // immediately in that safe state so the profile manifest already contains
  // the bundle before the next launch (the live market intentionally defers
  // this operation until its cold-start projector).
  const projected = await desktop.projectGenerations(dshHome, options.profile)
  const liveClientSync = options.syncLiveClient
    ? await synchronizeLiveClient({
        dshHome,
        generationDirectory: install.generation.directory,
        previousPackageDirectory: options.previousPackageDirectory,
      })
    : undefined
  return { install, exposed, published, projected, liveClientSync }
})

const manifest = await readJson(profileManifestPath)
const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
  ? manifest.dependencies
  : {}
const bundles = manifest.dsh?.profile?.bundles ?? []
if (typeof dependencies[PLUGIN_NAME] !== 'string') {
  throw new Error(`Generation published, but ${PLUGIN_NAME} is missing from ${profileManifestPath}`)
}
if (!bundles.includes(PLUGIN_NAME)) {
  throw new Error(`Generation published, but ${PLUGIN_NAME} is missing from dsh.profile.bundles`)
}

console.log(`Generation installed: ${result.install.generation.id}`)
if (result.exposed.length > 0) console.log(`Available for validation: ${result.exposed.join(', ')}`)
console.log(`Generation staged for next restart: ${result.published.plugins.join(', ')}`)
console.log(`Projected profile layers: ${result.projected.linked.join(', ')}`)
console.log(`Bundles: ${JSON.stringify(result.published.bundles)}`)
console.log(`Installed and registered: ${PLUGIN_NAME}@${dependencies[PLUGIN_NAME]}`)
if (result.liveClientSync !== undefined) {
  console.log(`Live client artifact synchronized: ${result.liveClientSync.target}`)
  console.log('The running DSH process can now receive the new Web Client through its built-in HMR; refresh the page to apply it.')
} else {
  console.log('The outer install.ps1 will now ask a running dshmarket to hot-mount this generation; invoking this helper directly still requires a restart.')
}
