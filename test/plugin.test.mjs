import assert from 'node:assert/strict'
import { chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

import {
  Config,
  GetnoteError,
  apply,
  buildTools,
  parseJsonOutput,
  quoteUnsafeIntegers,
  resolveGetnoteCommand,
  runGetnote,
  unwrapPayload,
} from '../index.js'

const fakePath = fileURLToPath(new URL('./fixtures/fake-getnote.mjs', import.meta.url))
const nodeFake = { command: process.execPath, prefixArgs: [fakePath] }
const originalBin = process.env.GETNOTE_BIN

before(() => {
  chmodSync(fakePath, 0o755)
  process.env.GETNOTE_BIN = fakePath
})

after(() => {
  if (originalBin === undefined) delete process.env.GETNOTE_BIN
  else process.env.GETNOTE_BIN = originalBin
})

function toolByName(name) {
  const tool = buildTools().find(definition => definition.name === name)
  assert.ok(tool, `missing tool ${name}`)
  return tool
}

async function runTool(name, args) {
  return await toolByName(name).execute(args, { signal: undefined })
}

test('preserves 19-digit snowflake IDs outside strings only', () => {
  const source = '{"note_id":1900000000000000001,"count":12,"big":9007199254740992,"title":"1900000000000000001"}'
  const parsed = JSON.parse(quoteUnsafeIntegers(source))

  assert.equal(parsed.note_id, '1900000000000000001')
  assert.equal(parsed.count, 12)
  assert.equal(parsed.big, '9007199254740992')
  assert.equal(parsed.title, '1900000000000000001')
})

test('parses JSON surrounded by CLI chatter and leaves plain text alone', () => {
  const parsed = parseJsonOutput('warning: cache miss\n{"success":true,"data":{"id":1900000000000000001}}\ntrailing')
  assert.equal(parsed.data.id, '1900000000000000001')

  assert.equal(parseJsonOutput('Authenticated. API key: ****9d27'), 'Authenticated. API key: ****9d27')
  assert.equal(parseJsonOutput(''), null)
})

test('unwraps success envelopes, bare objects, and failures', () => {
  assert.deepEqual(unwrapPayload({ success: true, data: { value: 1 } }), { value: 1 })
  assert.deepEqual(unwrapPayload({ note_id: '1', tags: [] }), { note_id: '1', tags: [] })
  assert.throws(
    () => unwrapPayload({ success: false, error: { code: 'UNAUTHORIZED', message: 'invalid api key' } }),
    (error) => error instanceof GetnoteError && /invalid api key/.test(error.message),
  )
})

test('resolves an explicit config path before GETNOTE_BIN', () => {
  const resolved = resolveGetnoteCommand()
  assert.equal(resolved.command, fakePath)
  assert.deepEqual(resolved.prefixArgs, [])

  const configured = resolveGetnoteCommand('/custom/getnote')
  assert.equal(configured.command, '/custom/getnote')
  assert.deepEqual(configured.prefixArgs, [])
})

test('exposes a Config schema with validation', () => {
  assert.equal(typeof Config, 'function')
  assert.doesNotThrow(() => Config({}))
  assert.throws(() => Config({ timeoutMs: 500 }))

  const config = Config({
    binaryPath: '/tmp/getnote',
    apiUrl: 'http://127.0.0.1:8080',
    timeoutMs: 5_000,
    maxOutputBytes: 10_240,
  })
  assert.equal(config.binaryPath, '/tmp/getnote')
  assert.equal(config.apiUrl, 'http://127.0.0.1:8080')
  assert.equal(config.timeoutMs, 5_000)
  assert.equal(config.maxOutputBytes, 10_240)
})

test('builds unique, well-formed tool schemas', () => {
  const tools = buildTools()
  const names = tools.map(tool => tool.name)

  assert.equal(new Set(names).size, names.length)
  assert.equal(tools.length, 15)
  for (const tool of tools) {
    assert.match(tool.name, /^getnote_/)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    for (const required of tool.parameters.required) {
      assert.ok(tool.parameters.properties[required], `${tool.name} requires unknown ${required}`)
    }
    assert.equal(tool.output.schema.type, 'string')
    assert.equal(tool.output.render({}, 'x')[0].text, 'x')
  }

  const deleteTool = toolByName('getnote_delete_note')
  assert.deepEqual(deleteTool.parameters.required, ['note_id', 'confirm'])
})

test('apply registers every tool plus the guidance skill and disposes them', () => {
  const registered = []
  const providers = []
  const disposed = []
  let cleanup
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition.name)
        return () => disposed.push(definition.name)
      },
    },
    skills: {
      registerProvider(create) {
        providers.push(create)
        return () => disposed.push('skill')
      },
    },
    get(name) {
      return name === 'skills' ? this.skills : undefined
    },
    effect(callback) {
      cleanup = callback()
      return cleanup
    },
    on() {
      return () => {}
    },
  }

  apply(ctx)
  assert.equal(registered.length, 15)
  assert.equal(providers.length, 1)
  cleanup()
  assert.equal(disposed.length, 16)
})

test('the bundled guidance skill is discoverable and loadable', async () => {
  const providers = []
  const ctx = {
    tools: { register: () => () => {} },
    skills: {
      registerProvider(create) {
        providers.push(create)
        return () => {}
      },
    },
    effect(callback) {
      return callback()
    },
    on() {
      return () => {}
    },
  }

  apply(ctx, {})
  assert.equal(providers.length, 1)

  const provider = providers[0]()
  assert.equal(provider.name, 'getnote-toolbox')
  const candidates = await provider.list({})
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'getnote-toolbox')
  assert.equal(candidates[0].source, 'bundled')

  const definition = await provider.get(candidates[0], {})
  assert.match(definition.content, /getnote_search/)
  assert.match(definition.content, /confirm: true/)
})

test('runs the CLI and preserves large IDs', async () => {
  const result = await runGetnote(['search', 'agent'], { command: nodeFake })
  assert.equal(result.success, true)
  assert.equal(result.data.results[0].note_id, '1900000000000000001')
  assert.equal(result.data.results[0].title, 'Agent Harness 笔记')
})

test('returns plain text for auth status', async () => {
  const result = await runGetnote(['auth', 'status'], { command: nodeFake })
  assert.match(result, /^Authenticated/)
})

test('rejects non-zero exits with a login hint', async () => {
  await assert.rejects(
    runGetnote(['fail'], { command: nodeFake }),
    (error) => error instanceof GetnoteError
      && error.exitCode === 1
      && /not authenticated/.test(error.message)
      && /getnote auth login/.test(error.message),
  )
})

test('search tool renders IDs as exact strings', async () => {
  const output = await runTool('getnote_search', { query: 'agent' })
  assert.match(output, /id: 1900000000000000001/)
  assert.match(output, /Agent Harness 笔记/)
  assert.match(output, /搜索片段/)
})

test('recent notes and detail tools render useful text', async () => {
  const recent = await runTool('getnote_recent_notes', { limit: 5 })
  assert.match(recent, /最近笔记/)
  assert.match(recent, /标签: 测试/)

  const detail = await runTool('getnote_note', { note_id: '1900000000000000001' })
  assert.match(detail, /# 详情标题/)
  assert.match(detail, /第一段。\n第二段。/)

  const truncated = await runTool('getnote_note', { note_id: '1900000000000000001', max_chars: 2 })
  assert.match(truncated, /内容已截断/)
})

test('tag tool lists tags with IDs and supports add/remove', async () => {
  const list = await runTool('getnote_tag', { action: 'list', note_id: '1900000000000000001' })
  assert.match(list, /测试（id: 611784754, manual）/)

  const add = await runTool('getnote_tag', {
    action: 'add',
    note_id: '1900000000000000001',
    tag: '新标签',
  })
  assert.match(add, /已为笔记 1900000000000000001 添加标签「新标签」/)
  assert.match(add, /当前标签（2）: 测试、插件自检/)

  const remove = await runTool('getnote_tag', {
    action: 'remove',
    note_id: '1900000000000000001',
    tag_id: '611784754',
  })
  assert.match(remove, /删除标签 611784754/)
})

test('save creates a note and reports the exact ID', async () => {
  const output = await runTool('getnote_save', {
    content: 'hello',
    title: '自检',
    tags: ['插件自检'],
  })
  assert.match(output, /已保存到得到大脑：自检（ID: 1900000000000000001）/)
  assert.match(output, /标签: 测试、插件自检/)
})

test('save handles a nested note response and reports unadopted tags', async () => {
  const output = await runTool('getnote_save', {
    content: 'https://example.com/',
    title: '链接自检',
    tags: ['手动标签'],
  })
  assert.match(output, /ID: 1900000000000000001/)
  assert.match(output, /类型: link/)
  assert.match(output, /标签: 测试、插件自检/)
  assert.match(output, /请求的标签未被笔记采纳：手动标签/)
})

test('update falls back for CLI 1.1.1 without --yes', async () => {
  process.env.FAKE_OLD_CLI = '1'
  try {
    const output = await runTool('getnote_update_note', {
      note_id: '1900000000000000001',
      title: '旧版 CLI 更新',
    })
    assert.match(output, /已更新笔记 1900000000000000001/)
  } finally {
    delete process.env.FAKE_OLD_CLI
  }
})

test('update, create-kb, add-to-kb and task tools render results', async () => {
  const updated = await runTool('getnote_update_note', {
    note_id: '1900000000000000001',
    title: '新标题',
    tags: ['一', '二'],
  })
  assert.match(updated, /已更新笔记 1900000000000000001（标题、标签）/)
  assert.match(updated, /当前标签: 更新后/)

  const created = await runTool('getnote_create_kb', { name: '新知识库', description: '说明' })
  assert.match(created, /已创建知识库「新知识库」（ID: newKb01）/)

  const added = await runTool('getnote_add_notes_to_kb', {
    topic_id: 'kb000001',
    note_ids: ['1900000000000000001'],
  })
  assert.match(added, /已把 1 条笔记加入知识库 kb000001/)

  const removed = await runTool('getnote_remove_notes_from_kb', {
    topic_id: 'kb000001',
    note_ids: ['1900000000000000001'],
  })
  assert.match(removed, /已从知识库 kb000001 移除 1 条笔记/)

  const task = await runTool('getnote_task', { task_id: 'task-1' })
  assert.match(task, /保存任务 task-1/)
  assert.match(task, /status: completed/)

  await assert.rejects(
    runTool('getnote_task', { task_id: 'missing-task' }),
    /没有查到保存任务 missing-task/,
  )
})

test('kb remove falls back for CLI 1.1.1 without --yes', async () => {
  process.env.FAKE_OLD_CLI = '1'
  try {
    const output = await runTool('getnote_remove_notes_from_kb', {
      topic_id: 'kb000001',
      note_ids: ['1900000000000000001'],
    })
    assert.match(output, /已从知识库 kb000001 移除 1 条笔记/)
  } finally {
    delete process.env.FAKE_OLD_CLI
  }
})

test('knowledge base tools render IDs and counts', async () => {
  const kbs = await runTool('getnote_list_knowledge_bases', {})
  assert.match(kbs, /测试知识库/)
  assert.match(kbs, /id: kb000001/)
  assert.match(kbs, /笔记 4 · 文件 3/)

  const notes = await runTool('getnote_kb_notes', { topic_id: 'kb000001', limit: 5 })
  assert.match(notes, /知识库 kb000001 内的笔记/)
  assert.match(notes, /id: 1900000000000000001/)
})

test('quota tool renders read and write buckets', async () => {
  const quota = await runTool('getnote_quota', {})
  assert.match(quota, /得到大脑 API 配额/)
  assert.match(quota, /读取/)
  assert.match(quota, /今日: 21 \/ 20000/)
})

test('delete requires explicit confirmation', async () => {
  await assert.rejects(
    runTool('getnote_delete_note', { note_id: '1900000000000000001' }),
    /confirm: true/,
  )

  const output = await runTool('getnote_delete_note', {
    note_id: '1900000000000000001',
    confirm: true,
  })
  assert.match(output, /移入回收站/)
})

test('rejects unsafe numeric IDs and empty required strings', async () => {
  await assert.rejects(
    runTool('getnote_note', { note_id: 1900000000000000001 }),
    /必须作为字符串/,
  )
  await assert.rejects(
    runTool('getnote_search', { query: '   ' }),
    /缺少参数/,
  )
})
