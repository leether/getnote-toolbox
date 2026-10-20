#!/usr/bin/env node
// Read-only smoke test against the real GetNote CLI.
// Usage: node scripts/smoke.mjs
import { buildTools } from '../index.js'

const tools = new Map(buildTools().map(tool => [tool.name, tool]))

async function call(name, args = {}) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  return await tool.execute(args, { signal: undefined })
}

function section(title, body) {
  console.log(`\n===== ${title} =====`)
  console.log(body)
}

const auth = await call('getnote_auth_status')
section('auth status', auth)
if (!/已登录/.test(auth)) {
  throw new Error('GetNote CLI 未登录，请先执行 getnote auth login')
}

section('quota', await call('getnote_quota'))
section('knowledge bases', await call('getnote_list_knowledge_bases', {}))

const search = await call('getnote_search', { query: 'Agent Harness', limit: 2 })
section('search', search)

const recent = await call('getnote_recent_notes', { limit: 2 })
section('recent notes', recent)

const idMatch = search.match(/id: (\d{5,})/)
if (idMatch) {
  const noteId = idMatch[1]
  section('note detail', await call('getnote_note', { note_id: noteId, max_chars: 400 }))
  section('tags', await call('getnote_tag', { action: 'list', note_id: noteId }))
}

console.log('\nsmoke test passed')
