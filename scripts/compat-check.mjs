#!/usr/bin/env node
/**
 * Host-compatibility probe.
 *
 * Every behaviour this plugin adds rests on a handful of seams inside the
 * installed DSH host packages (composer slots, subagent prompt content, the
 * scoped cancel verb).  A host upgrade is exactly when those seams move, so
 * run this before adapting a new Harness build: it reports which seams the
 * installed host no longer provides.
 *
 * Usage:
 *   node scripts/compat-check.mjs
 *   DSH_HOST_DIR="<...>/node_modules" node scripts/compat-check.mjs
 *
 * Exits 0 when every seam is present, 1 on drift, 0 with a skip notice when
 * no host installation can be found (CI without the desktop app).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const candidates = [
  process.env.DSH_HOST_DIR,
  process.env.APPDATA ? join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles', 'web', 'node_modules') : '',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'dshhost', 'node_modules') : ''
].filter((dir) => typeof dir === 'string' && dir !== '')

const root = candidates.find((dir) => existsSync(join(dir, '@deepseek-ai')))
if (root === undefined) {
  console.log('[compat] host packages not found; host seam checks skipped')
  process.exit(0)
}

const read = (pkg, file) => {
  const path = join(root, pkg, 'lib', file)
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

const conversation = read('@deepseek-ai/dsh-client-ui-conversation', 'client.js')
const sessions = read('@deepseek-ai/dsh-api-session-controller', 'client.js')
const sessionTypes = read('@deepseek-ai/dsh-api-session-controller', 'typert.host.js')
const chat = read('@deepseek-ai/dsh-client-ui-chat', 'client.js')

const checks = [
  {
    id: 'composer.slot',
    hint: 'side composer mounts conversation.composer.bar and conversation.input.attachments',
    ok: conversation.includes('"conversation.composer.bar"') && conversation.includes('"conversation.input.attachments"')
  },
  {
    id: 'composer.input',
    hint: 'native InputBar still renders the contenteditable draft (data-composer-input)',
    ok: conversation.includes('data-composer-input')
  },
  {
    id: 'composer.plus-button',
    hint: 'the "+" button keeps the _add / _tools classes the side CSS hides',
    ok: /"add":\s*"\w+_add"/.test(conversation) && /"tools":\s*"\w+_tools"/.test(conversation)
  },
  {
    id: 'composer.context-meter',
    hint: 'context meter is still a dialog trigger with the context.aria label',
    ok: conversation.includes('t("context.aria"') && conversation.includes('aria-haspopup')
  },
  {
    id: 'session.image-part',
    hint: 'prompt content still accepts { type: "image", mediaType, data }',
    ok: sessionTypes.includes("type: 'image'") && sessionTypes.includes('readonly mediaType')
  },
  {
    id: 'session.subagent-images',
    hint: 'only file parts are refused on the subagent continuation route',
    ok: sessions.includes('subagent continuation does not accept files') && sessions.includes('part.type === "file"')
  },
  {
    id: 'session.cancel',
    hint: 'scoped cancel verb still stops a running turn (edit-while-generating)',
    ok: conversation.includes('scopedSession("cancel")') || sessions.includes('"cancel"')
  },
  {
    id: 'session.subagent-address',
    hint: 'subagentAddress(id) still resolves a sidechat child to its parentSessionId',
    ok: sessions.includes('subagentAddress(') && sessions.includes('parentSessionId')
  },
  {
    id: 'chat.flow-rows',
    hint: 'chat rows still carry data-chat-flow-kind/-key and data-turn-tail for the edit pins',
    ok: chat.includes('"data-chat-flow-key"') && chat.includes('"data-chat-flow-kind"') && chat.includes('"data-turn-tail"')
  },
  {
    id: 'composer.dock',
    hint: 'conversation.input.dock is injected and InputBar still serializes reference chips',
    ok: conversation.includes('"conversation.input.dock"') && conversation.includes('serializeReference')
  }
]

let failed = 0
for (const check of checks) {
  if (check.ok) {
    console.log(`[compat] PASS ${check.id}`)
  } else {
    failed += 1
    console.log(`[compat] FAIL ${check.id} — ${check.hint}`)
  }
}

if (failed > 0) {
  console.log(`[compat] ${failed} seam(s) moved; see docs/COMPAT-CHECKLIST.md before adapting`)
  process.exit(1)
}
console.log(`[compat] all ${checks.length} host seams present`)
