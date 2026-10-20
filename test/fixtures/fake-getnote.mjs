#!/usr/bin/env node
// Test double for the getnote CLI. It answers the commands used by the plugin
// with representative payloads, including a 19-digit snowflake ID.
const rawArgs = process.argv.slice(2)
const outputIndex = rawArgs.indexOf('--output')
const output = outputIndex >= 0 || rawArgs.includes('-o')
const args = outputIndex >= 0
  ? rawArgs.filter((_arg, index) => index !== outputIndex && index !== outputIndex + 1)
  : rawArgs.filter(arg => arg !== '-o')
const command = args[0]
const BIG_ID = '1900000000000000001'
const BIG = '__BIG_ID__'

// JSON.stringify would round a 19-digit number, so emit the literal manually.
function send(payload) {
  process.stdout.write(JSON.stringify(payload).split('"__BIG_ID__"').join(BIG_ID))
}

if (!output) {
  console.error('fake-getnote: expected --output json')
  process.exit(2)
}

if (command === 'auth') {
  process.stdout.write('Authenticated. API key: *****************************************************************9d27\n')
  process.exit(0)
}

if (command === 'search') {
  send({
    success: true,
    data: {
      results: [
        {
          note_id: BIG,
          note_type: 'NOTE',
          title: 'Agent Harness 笔记',
          content: '这是用于测试的搜索片段。',
          created_at: '2026-10-19 10:55:40',
        },
      ],
    },
    results: null,
  })
  process.exit(0)
}

if (command === 'save') {
  const titleIndex = args.indexOf('--title')
  const title = titleIndex >= 0 ? args[titleIndex + 1] : '保存的笔记'
  const content = args[args.length - 1]
  if (/^https?:\/\//.test(content)) {
    send({
      success: true,
      data: {
        note: {
          note_id: BIG,
          title,
          note_type: 'link',
          created_at: '2026-10-19 10:55:40',
          tags: [{ id: '363198343', name: 'AI链接笔记', type: 'system' }],
        },
      },
    })
    process.exit(0)
  }
  send({
    success: true,
    data: {
      note_id: BIG,
      title,
      result: 'created',
      created_at: '2026-10-19 10:55:40',
    },
  })
  process.exit(0)
}

if (command === 'notes') {
  send({
    success: true,
    data: {
      notes: [
        {
          id: BIG,
          note_id: BIG,
          title: '最近笔记',
          content: '正文片段',
          note_type: 'plain_text',
          created_at: '2026-10-19 10:55:40',
          tags: [{ id: '611784754', name: '测试', type: 'manual' }],
        },
      ],
    },
    error: null,
  })
  process.exit(0)
}

if (command === 'note' && args[1] === 'update') {
  const oldCli = process.env.FAKE_OLD_CLI === '1'
  const confirmed = args.includes('-y') || args.includes('--yes')
  if (oldCli && confirmed) {
    console.error("Error: unknown shorthand flag: 'y' in -y")
    process.exit(1)
  }
  if (!oldCli && !confirmed) {
    send({
      success: false,
      data: null,
      error: {
        code: -1,
        message: '该操作需要明确确认；确认后重新执行并添加 --yes',
        reason: 'cli_error',
        retryable: false,
      },
    })
    process.exit(0)
  }
  send({
    success: true,
    data: { note_id: BIG, tags: ['更新后'] },
  })
  process.exit(0)
}

if (command === 'note' && args[1] === 'delete') {
  send({ success: true, data: { note_id: BIG } })
  process.exit(0)
}

if (command === 'note') {
  send({
    success: true,
    data: {
      note: {
        id: BIG,
        note_id: BIG,
        title: '详情标题',
        content: '第一段。\n第二段。',
        note_type: 'plain_text',
        created_at: '2026-10-19 10:55:40',
        updated_at: '2026-10-19 10:56:00',
        tags: ['测试'],
      },
    },
  })
  process.exit(0)
}

if (command === 'tag' && args[1] === 'list') {
  process.stdout.write(JSON.stringify({
    note_id: '1900000000000000001',
    tags: [
      { id: '611784754', name: '测试', type: 'manual' },
      { id: '611784755', name: '插件自检', type: 'manual' },
    ],
  }))
  process.exit(0)
}

if (command === 'tag') {
  send({
    success: true,
    data: { note_id: BIG, tags: [{ id: '1', name: args[args.length - 1], type: 'manual' }] },
  })
  process.exit(0)
}

if (command === 'kbs' || command === 'kbs-sub') {
  process.stdout.write(JSON.stringify({
    success: true,
    data: {
      topics: [
        {
          id: 'kb000001',
          topic_id: 'kb000001',
          name: '测试知识库',
          description: '知识库描述',
          stats: { note_count: 4, file_count: 3, blogger_count: 0, live_count: 0 },
        },
      ],
    },
  }))
  process.exit(0)
}

if (command === 'kb' && args[1] === 'create') {
  process.stdout.write(JSON.stringify({
    success: true,
    data: { topic_id: 'newKb01', name: args[args.length - 1] },
  }))
  process.exit(0)
}

if (command === 'kb' && args[1] === 'add') {
  process.stdout.write(JSON.stringify({ success: true, data: { added: args.length - 3 } }))
  process.exit(0)
}

if (command === 'kb' && args[1] === 'remove') {
  const oldCli = process.env.FAKE_OLD_CLI === '1'
  const confirmed = args.includes('-y') || args.includes('--yes')
  if (oldCli && confirmed) {
    console.error("Error: unknown shorthand flag: 'y' in -y")
    process.exit(1)
  }
  if (!oldCli && !confirmed) {
    send({
      success: false,
      data: null,
      error: {
        code: -1,
        message: '该操作需要明确确认；确认后重新执行并添加 --yes',
        reason: 'cli_error',
        retryable: false,
      },
    })
    process.exit(0)
  }
  const noteCount = args.slice(3).filter(arg => arg !== '-y' && arg !== '--yes').length
  send({ success: true, data: { removed_count: noteCount } })
  process.exit(0)
}

if (command === 'kb') {
  send({
    success: true,
    data: {
      notes: [
        {
          id: 0,
          note_id: BIG,
          title: '知识库笔记',
          content: '知识库内片段',
          note_type: 'plain_text',
          created_at: '2026-10-19 08:27:39',
          updated_at: '',
          tags: ['Paper2Agent'],
        },
      ],
    },
  })
  process.exit(0)
}

if (command === 'task') {
  if (String(args[1]).startsWith('missing')) {
    send({ success: false, data: { task_id: '', status: '', note_id: '', msg: '' } })
    process.exit(0)
  }
  send({
    success: true,
    data: { task_id: args[1], status: 'completed', note_id: BIG_ID },
  })
  process.exit(0)
}

if (command === 'quota') {
  process.stdout.write(JSON.stringify({
    success: true,
    data: {
      read: { daily: { limit: 20000, used: 21, remaining: 19979, reset_at: 1792425600 } },
      write: { monthly: { limit: 100000, used: 13, remaining: 99987, reset_at: 1793462400 } },
    },
  }))
  process.exit(0)
}

if (command === 'fail') {
  console.error('模拟失败：not authenticated')
  process.exit(1)
}

if (command === 'api-failure') {
  process.stdout.write(JSON.stringify({
    success: false,
    data: null,
    error: { code: 'UNAUTHORIZED', message: 'invalid api key' },
  }))
  process.exit(0)
}

process.stdout.write(JSON.stringify({ success: true, data: { argv: args } }))
