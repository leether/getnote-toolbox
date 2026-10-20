import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

const BINARY_NAME = 'getnote'

export const Config = Schema.object({
  binaryPath: Schema.string().description(
    'Optional absolute path to the getnote executable. Overrides GETNOTE_BIN and PATH.',
  ),
  apiUrl: Schema.string().description(
    'Optional GetNote OpenAPI base URL. Sets GETNOTE_API_URL for the CLI.',
  ),
  timeoutMs: Schema.number().min(1_000).description(
    'Per-command timeout in milliseconds. Overrides GETNOTE_TIMEOUT_MS; default 120000.',
  ),
  maxOutputBytes: Schema.number().min(1_024).description(
    'Per-command output cap in bytes. Overrides GETNOTE_MAX_OUTPUT_BYTES; default 16777216.',
  ),
})

/**
 * Timeout / output limits can be tuned without editing the bundle by launching
 * the Harness with these environment variables set.
 */
function envInteger(name, fallback, min, max) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

function findOnPath(name) {
  const pathValue = process.env.PATH ?? ''
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      for (const suffix of [extension, extension.toLowerCase()]) {
        const candidate = join(directory, `${name}${suffix}`)
        try {
          accessSync(candidate, constants.X_OK)
          return candidate
        } catch {
          // Keep looking.
        }
      }
    }
  }
  return undefined
}

function commonInstallDirectories() {
  const directories = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    join(homedir(), 'bin'),
  ]
  if (process.platform === 'win32' && process.env.APPDATA) {
    directories.push(join(process.env.APPDATA, 'npm'))
  }
  return directories
}

/**
 * Resolve the CLI invocation. An explicit `binaryPath` wins, then `GETNOTE_BIN`,
 * then PATH, then common install locations, and finally an npx fallback.
 */
export function resolveGetnoteCommand(binaryPath) {
  const configured = typeof binaryPath === 'string' ? binaryPath.trim() : ''
  const explicit = configured || process.env.GETNOTE_BIN?.trim()
  if (explicit) {
    const command = explicit === '~'
      ? homedir()
      : explicit.startsWith('~/') ? join(homedir(), explicit.slice(2)) : explicit
    return { command, prefixArgs: [] }
  }

  const pathBinary = findOnPath(BINARY_NAME)
  if (pathBinary) return { command: pathBinary, prefixArgs: [] }

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']
  for (const directory of commonInstallDirectories()) {
    for (const extension of extensions) {
      const candidate = join(directory, `${BINARY_NAME}${extension}`)
      try {
        accessSync(candidate, constants.X_OK)
        return { command: candidate, prefixArgs: [] }
      } catch {
        // Keep looking.
      }
    }
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    prefixArgs: ['--yes', '--package', '@getnote/cli@latest', '--', BINARY_NAME],
  }
}

export class GetnoteError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'GetnoteError'
    this.code = options.code
    this.exitCode = options.exitCode
    this.stderr = options.stderr
  }
}

function installHint() {
  return '请先安装并登录 GetNote CLI：`npm install -g @getnote/cli@latest`，然后执行 `getnote auth login`。'
}

function loginHintIfNeeded(message) {
  if (/not authenticated|not logged in|unauthori[sz]ed|\b401\b|未登录|登录已?失效/i.test(message)) {
    return `${message}\n提示：请先在终端执行 \`getnote auth login\` 完成浏览器授权，然后重试。`
  }
  return message
}

/**
 * Replace integer literals outside strings with quoted strings when they exceed
 * Number.MAX_SAFE_INTEGER. GetNote note IDs are 19-digit snowflakes; parsing
 * them as JS numbers silently truncates the last digits.
 */
export function quoteUnsafeIntegers(source) {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)
  let output = ''
  let index = 0
  let inString = false
  let escaped = false

  while (index < source.length) {
    const char = source[index]

    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      index += 1
      continue
    }

    const startsNumber = (char >= '0' && char <= '9')
      || (char === '-' && source[index + 1] >= '0' && source[index + 1] <= '9')

    if (startsNumber) {
      let cursor = char === '-' ? index + 1 : index
      while (cursor < source.length && source[cursor] >= '0' && source[cursor] <= '9') cursor += 1

      const next = source[cursor]
      if (next === '.' || next === 'e' || next === 'E') {
        let floatEnd = cursor
        while (floatEnd < source.length && /[0-9eE+\-.]/.test(source[floatEnd])) floatEnd += 1
        output += source.slice(index, floatEnd)
        index = floatEnd
        continue
      }

      const token = source.slice(index, cursor)
      let unsafe = false
      try {
        const value = BigInt(token)
        unsafe = value > maxSafe || value < -maxSafe
      } catch {
        unsafe = false
      }

      output += unsafe ? `"${token}"` : token
      index = cursor
      continue
    }

    output += char
    index += 1
  }

  return output
}

function extractJsonText(text) {
  const start = text.search(/[{\[]/)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

export function parseJsonOutput(text) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  if (!trimmed) return null

  const candidate = extractJsonText(trimmed)
  if (!candidate) return trimmed

  try {
    return JSON.parse(quoteUnsafeIntegers(candidate))
  } catch {
    return trimmed
  }
}

function formatApiError(payload) {
  const error = payload?.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    const parts = [error.message, error.reason, error.code]
      .filter(value => typeof value === 'string' && value.trim())
    if (parts.length) return parts.join(' / ')
  }
  const data = payload?.data
  if (data && typeof data === 'object') {
    const parts = [data.msg, data.message, data.status]
      .filter(value => typeof value === 'string' && value.trim())
    if (parts.length) return parts.join(' / ')
  }
  return '得到大脑接口返回失败（success=false，未提供错误详情）'
}

/**
 * Unwrap the CLI's `{ success, data }` envelope. `tag list` (and a few other
 * commands) return a bare object, which is passed through unchanged.
 */
export function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload

  if (payload.success === false) {
    throw new GetnoteError(formatApiError(payload), { code: payload.error?.code })
  }

  if (payload.success === true) {
    return payload.data === undefined ? payload : payload.data
  }

  return payload
}

/**
 * Run the GetNote CLI and return its parsed JSON (or plain text for commands
 * such as `auth status`). Arguments are always passed as an array and never
 * through a shell.
 */
export async function runGetnote(args, options = {}) {
  const invocation = options.command ?? resolveGetnoteCommand(options.binaryPath)
  const timeoutMs = options.timeoutMs
    ?? envInteger('GETNOTE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1_000, 1_800_000)
  const maxOutputBytes = options.maxOutputBytes
    ?? envInteger('GETNOTE_MAX_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES, 1_024, 256 * 1024 * 1024)
  const signal = options.signal

  // Put the persistent output flag before the subcommand so callers can use
  // `--` to protect positional text that starts with a hyphen.
  const commandArgs = [...invocation.prefixArgs, '--output', 'json', ...args]

  return await new Promise((resolve, reject) => {
    let settled = false
    let timer
    let failureMode

    const stdout = []
    const stderr = []
    let capturedBytes = 0

    const child = spawn(invocation.command, commandArgs, {
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(options.apiUrl ? { GETNOTE_API_URL: options.apiUrl } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      reject(error)
    }

    const succeed = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onAbort = () => {
      failureMode = 'aborted'
      child.kill('SIGTERM')
    }

    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener?.('abort', onAbort, { once: true })
    }

    const capture = (target, chunk) => {
      if (settled) return
      capturedBytes += chunk.length
      if (capturedBytes > maxOutputBytes) {
        failureMode = 'overflow'
        child.kill('SIGTERM')
        return
      }
      target.push(chunk)
    }

    child.stdout.on('data', chunk => capture(stdout, chunk))
    child.stderr.on('data', chunk => capture(stderr, chunk))

    child.on('error', (error) => {
      fail(new GetnoteError(
        `无法启动 ${BINARY_NAME}（${invocation.command}）：${error.message}\n${installHint()}`,
      ))
    })

    timer = setTimeout(() => {
      failureMode = 'timeout'
      child.kill('SIGTERM')
    }, timeoutMs)
    timer.unref?.()

    child.on('close', (code) => {
      if (settled) return
      const stdoutText = Buffer.concat(stdout).toString('utf8').trim()
      const stderrText = Buffer.concat(stderr).toString('utf8').trim()

      if (failureMode === 'timeout') {
        fail(new GetnoteError(`getnote 命令超时（${timeoutMs} ms）。可通过 GETNOTE_TIMEOUT_MS 调整。`))
        return
      }
      if (failureMode === 'aborted') {
        fail(new GetnoteError('getnote 命令已取消。'))
        return
      }
      if (failureMode === 'overflow') {
        fail(new GetnoteError(`getnote 输出超过上限（${maxOutputBytes} bytes）。可通过 GETNOTE_MAX_OUTPUT_BYTES 调整。`))
        return
      }

      const payload = parseJsonOutput(stdoutText)

      if (code !== 0) {
        let message
        if (payload && typeof payload === 'object' && payload.success === false) {
          message = formatApiError(payload)
        } else {
          message = stderrText || stdoutText || `getnote 退出码 ${String(code)}`
        }
        fail(new GetnoteError(loginHintIfNeeded(message), { exitCode: code, stderr: stderrText }))
        return
      }

      succeed(payload)
    })
  })
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

const S = {
  string(description) {
    return { type: 'string', description }
  },
  integer(description, options = {}) {
    const schema = { type: 'integer', description }
    if (options.minimum !== undefined) schema.minimum = options.minimum
    if (options.maximum !== undefined) schema.maximum = options.maximum
    if (options.default !== undefined) schema.default = options.default
    return schema
  },
  boolean(description, options = {}) {
    const schema = { type: 'boolean', description }
    if (options.default !== undefined) schema.default = options.default
    return schema
  },
  stringArray(description, options = {}) {
    const schema = { type: 'array', description, items: { type: 'string' } }
    if (options.minItems !== undefined) schema.minItems = options.minItems
    if (options.maxItems !== undefined) schema.maxItems = options.maxItems
    return schema
  },
  object(properties, required = []) {
    return { type: 'object', properties, required, additionalProperties: false }
  },
}

function argString(args, key, label) {
  const value = args?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new GetnoteError(`缺少参数 ${label ?? key}（${key}），需要非空字符串。`)
}

function argOptionalString(args, key, label) {
  const value = args?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new GetnoteError(`${label ?? key}（${key}）如果提供，必须是非空字符串。`)
  }
  return value.trim()
}

function argId(args, key, label) {
  const value = args?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new GetnoteError(`${label ?? key} 是雪花 ID，必须作为字符串传入，避免精度丢失。`)
    }
    return String(value)
  }
  if (value === undefined || value === null) {
    throw new GetnoteError(`缺少参数 ${label ?? key}（${key}）。`)
  }
  throw new GetnoteError(`${label ?? key}（${key}）必须是字符串。`)
}

function argOptionalId(args, key, label) {
  const value = args?.[key]
  if (value === undefined || value === null || value === '') return undefined
  return argId(args, key, label)
}

function argInteger(args, key, fallback, min, max) {
  const value = args?.[key]
  if (value === undefined || value === null) return fallback
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new GetnoteError(`${key} 必须是 ${min} 到 ${max} 之间的整数。`)
  }
  return numeric
}

function normalizeIdList(raw, key) {
  const values = typeof raw === 'string'
    ? raw.split(',').map(part => part.trim()).filter(Boolean)
    : raw

  if (!Array.isArray(values)) {
    throw new GetnoteError(`${key} 必须是字符串数组。`)
  }

  return values.map((value) => {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
    throw new GetnoteError(`${key} 中的每一项都必须是字符串 ID。`)
  })
}

function argStringArray(args, key, options = {}) {
  const value = args?.[key]
  const min = options.min ?? 0
  const max = options.max ?? 200

  if (value === undefined || value === null) {
    if (min > 0) throw new GetnoteError(`缺少参数 ${key}，至少需要 ${min} 项。`)
    return []
  }

  const values = normalizeIdList(value, key)
  if (values.length < min) throw new GetnoteError(`${key} 至少需要 ${min} 项。`)
  if (values.length > max) throw new GetnoteError(`${key} 最多支持 ${max} 项。`)
  return values
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function oneLine(value, maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function noteIdOf(note) {
  const value = note?.note_id ?? note?.id
  return value === undefined || value === null ? '' : String(value)
}

function tagNames(tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .map(tag => (typeof tag === 'string' ? tag : tag?.name))
    .filter(name => typeof name === 'string' && name.trim())
    .map(name => name.trim())
}

function typeOfNote(note) {
  return note?.resource_type || note?.note_type || note?.type || ''
}

function formatNote(note, index) {
  const title = oneLine(note?.display_title || note?.title || '(无标题)', 100)
  const lines = [`${index}. ${title}`]
  const meta = []
  const id = noteIdOf(note)
  if (id) meta.push(`id: ${id}`)
  const type = typeOfNote(note)
  if (type) meta.push(type)
  if (note?.created_at) meta.push(note.created_at)
  const tags = tagNames(note?.tags)
  if (tags.length) meta.push(`标签: ${tags.join('、')}`)
  if (meta.length) lines.push(`   ${meta.join(' · ')}`)

  const snippet = oneLine(note?.snippet ?? note?.excerpt ?? note?.preview ?? note?.content ?? '', 220)
  if (snippet) lines.push(`   ${snippet}`)
  return lines.join('\n')
}

function formatNoteList(notes, options) {
  const list = Array.isArray(notes) ? notes : []
  if (!list.length) {
    return `${options.heading}：没有${options.emptySuffix ?? '笔记'}。`
  }
  const header = `${options.heading}（${list.length} 条${options.truncated ? '，已按请求截断' : ''}）：`
  return `${header}\n\n${list.map((note, index) => formatNote(note, index + 1)).join('\n\n')}`
}

function formatNoteDetail(note, maxChars) {
  const lines = [`# ${oneLine(note?.display_title || note?.title || '(无标题)', 200)}`]
  const meta = []
  const id = noteIdOf(note)
  if (id) meta.push(`ID: ${id}`)
  if (note?.note_type) meta.push(`类型: ${note.note_type}`)
  if (note?.created_at) meta.push(`创建: ${note.created_at}`)
  if (note?.updated_at) meta.push(`更新: ${note.updated_at}`)
  if (meta.length) lines.push(meta.join(' · '))

  const tags = tagNames(note?.tags)
  if (tags.length) lines.push(`标签: ${tags.join('、')}`)

  const url = note?.url || note?.link || note?.reference?.url
  if (url) lines.push(`链接: ${url}`)

  lines.push('---')
  const content = typeof note?.content === 'string' ? note.content : ''
  if (!content) {
    lines.push('（没有正文内容；这可能是链接、图片或文件笔记。）')
  } else if (maxChars === 0 || content.length <= maxChars) {
    lines.push(content)
  } else {
    lines.push(content.slice(0, maxChars))
    lines.push('')
    lines.push(`…（内容已截断：显示 ${maxChars}/${content.length} 字符。传 max_chars: 0 读取全文。）`)
  }
  return lines.join('\n')
}

function formatEpoch(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const milliseconds = value < 1e12 ? value * 1000 : value
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function renderKeyValues(value) {
  if (value === null || value === undefined) return '（无返回数据）'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    return value.map(item => `- ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join('\n')
  }
  return Object.entries(value)
    .map(([key, item]) => {
      const rendered = item === null || item === undefined
        ? ''
        : typeof item === 'object' ? JSON.stringify(item) : String(item)
      return `${key}: ${rendered}`
    })
    .join('\n')
}

function renderAuthStatus(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')

  if (/not authenticated|not logged in|unauthori[sz]ed|\b401\b|未登录|未授权/i.test(text)) {
    return '未登录得到大脑。请在终端执行 `getnote auth login` 完成浏览器授权，然后重试。'
  }
  if (/authenticated|logged in|已登录/i.test(text)) {
    return '已登录得到大脑（凭证由本机 GetNote CLI 管理，工具不会读取或回显 API Key）。'
  }

  const sanitized = text.split(/API key:/i)[0].trim()
  return sanitized || '登录状态未知，请运行 `getnote auth status` 查看。'
}

function renderKnowledgeBases(topics, subscribed) {
  const list = Array.isArray(topics) ? topics : []
  const heading = subscribed ? '订阅的知识库' : '我的知识库'
  if (!list.length) return `${heading}：没有。`

  const lines = [`${heading}（${list.length} 个）：`]
  list.forEach((topic, index) => {
    const id = topic?.topic_id ?? topic?.id ?? ''
    const stats = topic?.stats ?? {}
    const numbers = []
    if (Number.isFinite(stats.note_count)) numbers.push(`笔记 ${stats.note_count}`)
    if (Number.isFinite(stats.file_count)) numbers.push(`文件 ${stats.file_count}`)
    if (Number.isFinite(stats.blogger_count) && stats.blogger_count > 0) numbers.push(`博主 ${stats.blogger_count}`)
    if (Number.isFinite(stats.live_count) && stats.live_count > 0) numbers.push(`直播 ${stats.live_count}`)

    lines.push('')
    lines.push(`${index + 1}. ${oneLine(topic?.name || '(未命名知识库)', 80)}`)
    const meta = []
    if (id) meta.push(`id: ${String(id)}`)
    if (topic?.scope) meta.push(topic.scope)
    if (numbers.length) meta.push(numbers.join(' · '))
    if (meta.length) lines.push(`   ${meta.join(' · ')}`)
    const description = oneLine(topic?.description || '', 180)
    if (description) lines.push(`   ${description}`)
  })
  return lines.join('\n')
}

function renderQuota(data) {
  if (!data || typeof data !== 'object') return `配额查询结果：\n${renderKeyValues(data)}`

  const labels = {
    read: '读取',
    write: '写入',
    write_note: '笔记写入',
    read_note: '笔记读取',
  }
  const lines = ['得到大脑 API 配额：']

  for (const [kind, periods] of Object.entries(data)) {
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) continue
    lines.push('')
    lines.push(`${labels[kind] ?? kind}：`)
    for (const [period, stat] of Object.entries(periods)) {
      if (!stat || typeof stat !== 'object') continue
      const periodLabel = period === 'daily' ? '今日' : period === 'monthly' ? '本月' : period
      const reset = formatEpoch(stat.reset_at)
      lines.push([
        `  ${periodLabel}: ${stat.used ?? '-'} / ${stat.limit ?? '-'}（剩余 ${stat.remaining ?? '-'}）`,
        reset ? ` · 重置 ${reset}` : '',
      ].join(''))
    }
  }

  return lines.length > 1 ? lines.join('\n') : `配额查询结果：\n${renderKeyValues(data)}`
}

function renderSearchResults(query, results, truncated) {
  if (!results.length) {
    return `没有找到与「${query}」相关的笔记。语义搜索是 Top-K 召回，零命中不代表库里没有相关内容。`
  }
  return formatNoteList(results, {
    heading: `与「${query}」相关的笔记`,
    truncated,
  })
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const textOutput = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  },
}

function tool(name, description, parameters, execute) {
  return { name, description, parameters, output: textOutput, execute }
}

function normalizeConfig(config = {}) {
  const normalized = {}
  if (typeof config?.binaryPath === 'string' && config.binaryPath.trim()) {
    normalized.binaryPath = config.binaryPath.trim()
  }
  if (typeof config?.apiUrl === 'string' && config.apiUrl.trim()) {
    normalized.apiUrl = config.apiUrl.trim()
  }
  if (Number.isInteger(config?.timeoutMs)) normalized.timeoutMs = config.timeoutMs
  if (Number.isInteger(config?.maxOutputBytes)) normalized.maxOutputBytes = config.maxOutputBytes
  return normalized
}

function runnerOptions(config, signal) {
  return {
    binaryPath: config?.binaryPath,
    apiUrl: config?.apiUrl,
    timeoutMs: config?.timeoutMs,
    maxOutputBytes: config?.maxOutputBytes,
    signal,
  }
}

function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

async function fetchNoteTags(noteId, exec, config) {
  const data = unwrapPayload(await runGetnote(
    ['tag', 'list', noteId],
    runnerOptions(config, exec.signal),
  ))
  return Array.isArray(data?.tags) ? data.tags : []
}

const SKILL_NAME = 'getnote-toolbox'
const SKILL_PROVIDER = 'getnote-toolbox'
const SKILL_DESCRIPTION = '在 DeepSeek Harness 中使用得到大脑：优先通过 getnote_* 原生工具搜索、保存、读取、更新、打标签和管理知识库。'
const SKILL_WHEN = '用户要搜索、保存、阅读、修改、删除得到大脑笔记，或管理标签、知识库、配额、保存任务时。'
const SKILL_CONTENT = `# 得到大脑工具箱

当用户提到得到大脑 / Get笔记的搜索、保存、读取、更新、删除、标签、知识库、配额或保存任务时，优先使用 \`getnote_*\` 原生工具，而不是自己拼 Shell 命令或构造 API 请求。

## 工具选择

- 找笔记：\`getnote_search\`；最近笔记：\`getnote_recent_notes\`
- 读全文：\`getnote_note\`（\`max_chars: 0\` 读全文）
- 保存：\`getnote_save\`（文字、URL 或图片；图片用绝对路径）
- 修改/删除：\`getnote_update_note\` / \`getnote_delete_note\`
- 标签：\`getnote_tag\`（\`remove\` 需要先 \`list\` 拿 tag_id）
- 知识库：\`getnote_list_knowledge_bases\` / \`getnote_kb_notes\` / \`getnote_create_kb\` / \`getnote_add_notes_to_kb\` / \`getnote_remove_notes_from_kb\`
- 配额/任务：\`getnote_quota\` / \`getnote_task\`

## 规则

- 笔记 ID、标签 ID 始终按字符串传递，不要转成数字。
- 删除只移入回收站，必须用户明确要求，并传 \`confirm: true\`。
- 更新笔记的 \`tags\` 是覆盖式替换；先读取当前标签再决定。
- 保存后如果提示“请求的标签未被笔记采纳”，如实告诉用户，不要声称已打上。
- 未登录时提示用户在终端执行 \`getnote auth login\`。
- 原生工具不覆盖的能力（转写、附件、分享等），使用已安装的 GetNote 领域 Skill 或 CLI；不要自行构造 API。
`

function createGetnoteSkillProvider() {
  const summary = {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: SKILL_PROVIDER,
  }
  return {
    name: SKILL_PROVIDER,
    async list() {
      return [{ ...summary, rank: 600, locator: { name: SKILL_NAME } }]
    },
    async get(candidate) {
      if (candidate?.name !== SKILL_NAME) return undefined
      return { ...summary, content: SKILL_CONTENT }
    },
  }
}

export function buildTools(config = {}) {
  return [
    tool(
      'getnote_auth_status',
      '检查本机 GetNote（得到大脑）CLI 的登录状态。不会读取或回显 API Key。',
      S.object({}),
      async (_args, exec) => {
        const raw = await runGetnote(['auth', 'status'], runnerOptions(config, exec.signal))
        return renderAuthStatus(raw)
      },
    ),

    tool(
      'getnote_search',
      '在得到大脑中做语义搜索（Top-K，最多 10 条），可限定知识库。用户要找“关于某主题的笔记”时优先使用。返回笔记 ID、标题、时间与片段；笔记 ID 始终按字符串使用。',
      S.object({
        query: S.string('自然语言搜索词。'),
        knowledge_base_id: S.string('可选：知识库 ID（topic_id），只在该库内搜索。'),
        limit: S.integer('返回条数，1-10。', { minimum: 1, maximum: 10, default: 10 }),
      }, ['query']),
      async (args, exec) => {
        const query = argString(args, 'query', '搜索词')
        const limit = argInteger(args, 'limit', 10, 1, 10)
        const knowledgeBaseId = argOptionalId(args, 'knowledge_base_id', '知识库 ID')

        const cliArgs = ['search', '--limit', String(limit)]
        if (knowledgeBaseId) cliArgs.push('--kb', knowledgeBaseId)
        cliArgs.push('--', query)

        const data = unwrapPayload(await runGetnote(cliArgs, runnerOptions(config, exec.signal)))
        const results = Array.isArray(data)
          ? data
          : Array.isArray(data?.results) ? data.results
            : Array.isArray(data?.notes) ? data.notes
              : []

        return renderSearchResults(query, results.slice(0, limit), results.length > limit)
      },
    ),

    tool(
      'getnote_save',
      '把文字、网页链接或本地图片保存到得到大脑。可设置标题和标签。本地图片请传绝对路径（~/ 会展开）。',
      S.object({
        content: S.string('要保存的文字、URL 或本地图片绝对路径。'),
        title: S.string('可选：笔记标题。'),
        tags: S.stringArray('可选：标签列表。', { maxItems: 20 }),
      }, ['content']),
      async (args, exec) => {
        const content = expandHome(argString(args, 'content', '要保存的内容'))
        const title = argOptionalString(args, 'title', '标题')
        const tags = argStringArray(args, 'tags', { max: 20 })

        const cliArgs = ['save']
        if (title) cliArgs.push('--title', title)
        for (const tag of tags) cliArgs.push('--tag', tag)
        cliArgs.push('--', content)

        const data = unwrapPayload(await runGetnote(cliArgs, runnerOptions(config, exec.signal)))
        const detail = data && typeof data === 'object' ? data : {}
        const note = detail.note && typeof detail.note === 'object' ? detail.note : detail
        const noteId = note.note_id ?? note.id ?? detail.note_id ?? detail.id
        const taskId = detail.task_id ?? detail.taskId ?? note.task_id

        const lines = []
        if (noteId !== undefined && noteId !== null && noteId !== '') {
          lines.push(`已保存到得到大脑：${oneLine(note.title || title || content, 100)}（ID: ${String(noteId)}）`)
          if (note.note_type) lines.push(`类型: ${note.note_type}`)
        } else if (taskId !== undefined && taskId !== null && taskId !== '') {
          lines.push(`已提交保存任务（task_id: ${String(taskId)}）。可用 getnote_task 查询处理进度。`)
        } else {
          lines.push('保存请求已完成，但接口没有返回笔记 ID 或任务 ID。')
        }
        const createdAt = note.created_at || detail.created_at
        if (createdAt) lines.push(`创建时间: ${createdAt}`)

        const returnedTags = tagNames(note.tags ?? detail.tags)
        if (tags.length && noteId) {
          try {
            const currentTags = tagNames(await fetchNoteTags(noteId, exec, config))
            lines.push(`标签: ${currentTags.length ? currentTags.join('、') : '（无）'}`)
            const missing = tags.filter(tag => !currentTags.includes(tag))
            if (missing.length) {
              lines.push(`注意：请求的标签未被笔记采纳：${missing.join('、')}。该笔记类型可能只保留系统/AI 标签。`)
            }
          } catch {
            lines.push(`请求的标签: ${tags.join('、')}（未能核验实际标签）`)
          }
        } else if (returnedTags.length) {
          lines.push(`标签: ${returnedTags.join('、')}`)
        } else if (tags.length) {
          lines.push(`请求的标签: ${tags.join('、')}（未能核验实际标签）`)
        }

        if (!noteId && !taskId) {
          const summary = {}
          for (const key of ['result', 'status', 'message', 'msg', 'task_id', 'note_id']) {
            if (detail[key] !== undefined && detail[key] !== null && detail[key] !== '') summary[key] = detail[key]
          }
          if (Object.keys(summary).length) lines.push(renderKeyValues(summary))
        }
        return lines.join('\n')
      },
    ),

    tool(
      'getnote_recent_notes',
      '列出得到大脑的最近笔记。返回笔记 ID、标题、时间、标签和内容片段。',
      S.object({
        limit: S.integer('返回条数，1-100。', { minimum: 1, maximum: 100, default: 20 }),
        since_id: S.string('可选：分页游标（上一页最后一条笔记 ID）。'),
      }),
      async (args, exec) => {
        const limit = argInteger(args, 'limit', 20, 1, 100)
        const sinceId = argOptionalId(args, 'since_id', '分页游标')

        const cliArgs = ['notes', '--limit', String(limit)]
        if (sinceId) cliArgs.push('--since-id', sinceId)

        const data = unwrapPayload(await runGetnote(cliArgs, runnerOptions(config, exec.signal)))
        const notes = Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : []

        return formatNoteList(notes.slice(0, limit), {
          heading: '最近笔记',
          truncated: notes.length > limit,
        })
      },
    ),

    tool(
      'getnote_note',
      '按笔记 ID 读取得到大脑笔记详情和正文。笔记 ID 必须按字符串传递。正文过长时可用 max_chars 截断。',
      S.object({
        note_id: S.string('笔记 ID（雪花 ID，按字符串传递）。'),
        max_chars: S.integer('正文最多返回多少字符；0 表示不截断。', {
          minimum: 0,
          maximum: 200_000,
          default: 12_000,
        }),
      }, ['note_id']),
      async (args, exec) => {
        const noteId = argId(args, 'note_id', '笔记 ID')
        const maxChars = argInteger(args, 'max_chars', 12_000, 0, 200_000)

        const data = unwrapPayload(await runGetnote(['note', noteId], runnerOptions(config, exec.signal)))
        const note = data?.note ?? data
        if (!note || typeof note !== 'object') {
          throw new GetnoteError(`没有读到笔记 ${noteId} 的详情。`)
        }
        return formatNoteDetail(note, maxChars)
      },
    ),

    tool(
      'getnote_update_note',
      '更新得到大脑笔记的标题、正文或标签。注意：tags 是覆盖式替换（会替换原有全部标签）；content 只适用于纯文本笔记。',
      S.object({
        note_id: S.string('要更新的笔记 ID。'),
        title: S.string('可选：新标题。'),
        content: S.string('可选：新正文（仅纯文本笔记）。'),
        tags: S.stringArray('可选：新的完整标签列表（覆盖原有标签）。', { minItems: 1, maxItems: 20 }),
      }, ['note_id']),
      async (args, exec) => {
        const noteId = argId(args, 'note_id', '笔记 ID')
        const title = argOptionalString(args, 'title', '标题')
        const content = argOptionalString(args, 'content', '正文')
        const tags = args?.tags === undefined ? undefined : argStringArray(args, 'tags', { min: 1, max: 20 })

        if (title === undefined && content === undefined && tags === undefined) {
          throw new GetnoteError('请至少提供 title、content 或 tags 中的一项。')
        }

        // CLI 1.8.0 requires an explicit confirmation for replacing content/tags.
        // CLI 1.1.1 does not know -y, so retry without it on an unknown-flag error.
        const cliArgs = ['note', 'update', noteId]
        if (title !== undefined) cliArgs.push('--title', title)
        if (content !== undefined) cliArgs.push('--content', content)
        if (tags !== undefined) cliArgs.push('--tag', tags.join(','))

        let data
        try {
          data = unwrapPayload(await runGetnote(
            [...cliArgs, '-y'],
            runnerOptions(config, exec.signal),
          ))
        } catch (error) {
          if (error instanceof GetnoteError && /unknown (shorthand )?flag/i.test(error.message)) {
            data = unwrapPayload(await runGetnote(
              cliArgs,
              runnerOptions(config, exec.signal),
            ))
          } else {
            throw error
          }
        }
        const changed = []
        if (title !== undefined) changed.push('标题')
        if (content !== undefined) changed.push('正文')
        if (tags !== undefined) changed.push('标签')

        const lines = [`已更新笔记 ${noteId}（${changed.join('、')}）。`]
        const currentTags = tagNames(data?.tags)
        if (currentTags.length) lines.push(`当前标签: ${currentTags.join('、')}`)
        else if (tags !== undefined) lines.push(`当前标签: ${tags.join('、')}`)
        return lines.join('\n')
      },
    ),

    tool(
      'getnote_delete_note',
      '把得到大脑笔记移入回收站（可恢复）。这是写操作，必须显式传入 confirm: true；仅在用户明确要求删除时使用。',
      S.object({
        note_id: S.string('要删除的笔记 ID。'),
        confirm: S.boolean('必须为 true 才会执行删除。', { default: false }),
      }, ['note_id', 'confirm']),
      async (args, exec) => {
        if (args?.confirm !== true) {
          throw new GetnoteError('删除笔记需要显式传入 confirm: true。请先向用户确认，再重试。')
        }
        const noteId = argId(args, 'note_id', '笔记 ID')
        const data = unwrapPayload(await runGetnote(['note', 'delete', noteId, '-y'], runnerOptions(config, exec.signal)))
        const deletedId = data?.note_id ?? noteId
        return `已把笔记 ${String(deletedId)} 移入回收站（可在得到大脑回收站恢复）。`
      },
    ),

    tool(
      'getnote_tag',
      '查看、添加或删除笔记标签。action=remove 时必须提供标签 ID（先 action=list 获取），不能把标签名当 ID；系统标签不可删除。',
      S.object({
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove'],
          description: '操作：list 查看、add 添加、remove 按标签 ID 删除。',
        },
        note_id: S.string('笔记 ID。'),
        tag: S.string('action=add 时：要添加的标签名。'),
        tag_id: S.string('action=remove 时：标签 ID（不是名称）。'),
      }, ['action', 'note_id']),
      async (args, exec) => {
        const action = argString(args, 'action', '操作')
        const noteId = argId(args, 'note_id', '笔记 ID')

        if (action === 'list') {
          const data = unwrapPayload(await runGetnote(['tag', 'list', noteId], runnerOptions(config, exec.signal)))
          const tags = Array.isArray(data?.tags) ? data.tags : []
          if (!tags.length) return `笔记 ${noteId} 目前没有标签。`
          const lines = [`笔记 ${noteId} 的标签（${tags.length}）：`]
          tags.forEach((tag, index) => {
            if (typeof tag === 'string') {
              lines.push(`${index + 1}. ${tag}`)
              return
            }
            const suffix = [
              tag?.id !== undefined ? `id: ${String(tag.id)}` : '',
              tag?.type ? tag.type : '',
            ].filter(Boolean).join(', ')
            lines.push(`${index + 1}. ${tag?.name ?? '(未命名)'}${suffix ? `（${suffix}）` : ''}`)
          })
          return lines.join('\n')
        }

        if (action === 'add') {
          const tag = argString(args, 'tag', '标签名')
          const data = unwrapPayload(await runGetnote(['tag', 'add', noteId, '--', tag], runnerOptions(config, exec.signal)))
          const responseTags = tagNames(data?.tags)
          let currentTags
          try {
            currentTags = tagNames(await fetchNoteTags(noteId, exec, config))
          } catch {
            currentTags = undefined
          }
          const lines = [`已为笔记 ${noteId} 添加标签「${tag}」。`]
          if (currentTags !== undefined) {
            lines.push(`当前标签（${currentTags.length}）: ${currentTags.length ? currentTags.join('、') : '（无）'}`)
          } else if (responseTags.length) {
            lines.push(`本次操作返回的标签: ${responseTags.join('、')}`)
          }
          return lines.join('\n')
        }

        if (action === 'remove') {
          const tagId = argId(args, 'tag_id', '标签 ID')
          const data = unwrapPayload(await runGetnote(['tag', 'remove', noteId, tagId], runnerOptions(config, exec.signal)))
          const responseTags = tagNames(data?.tags)
          let currentTags
          try {
            currentTags = tagNames(await fetchNoteTags(noteId, exec, config))
          } catch {
            currentTags = undefined
          }
          const lines = [`已从笔记 ${noteId} 删除标签 ${tagId}。`]
          if (currentTags !== undefined) {
            lines.push(`当前标签（${currentTags.length}）: ${currentTags.length ? currentTags.join('、') : '（无）'}`)
          } else if (responseTags.length) {
            lines.push(`本次操作返回的标签: ${responseTags.join('、')}`)
          }
          return lines.join('\n')
        }

        throw new GetnoteError('action 必须是 list、add 或 remove。')
      },
    ),

    tool(
      'getnote_list_knowledge_bases',
      '列出得到大脑的知识库（默认自有；subscribed=true 时列出订阅的知识库）。返回知识库 ID、名称、描述和内容统计。',
      S.object({
        subscribed: S.boolean('为 true 时列出订阅的知识库；默认列出自有知识库。', { default: false }),
      }),
      async (args, exec) => {
        const subscribed = args?.subscribed === true
        const data = unwrapPayload(await runGetnote([subscribed ? 'kbs-sub' : 'kbs'], runnerOptions(config, exec.signal)))
        const topics = Array.isArray(data)
          ? data
          : Array.isArray(data?.topics) ? data.topics
            : Array.isArray(data?.knowledge_bases) ? data.knowledge_bases
              : []
        return renderKnowledgeBases(topics, subscribed)
      },
    ),

    tool(
      'getnote_kb_notes',
      '列出某个得到大脑知识库内的笔记。先用 getnote_list_knowledge_bases 获取 topic_id。',
      S.object({
        topic_id: S.string('知识库 ID（topic_id）。'),
        limit: S.integer('返回条数，1-100。', { minimum: 1, maximum: 100, default: 20 }),
      }, ['topic_id']),
      async (args, exec) => {
        const topicId = argId(args, 'topic_id', '知识库 ID')
        const limit = argInteger(args, 'limit', 20, 1, 100)

        const data = unwrapPayload(await runGetnote(
          ['kb', topicId, '--limit', String(limit)],
          runnerOptions(config, exec.signal),
        ))
        const notes = Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : []

        return formatNoteList(notes.slice(0, limit), {
          heading: `知识库 ${topicId} 内的笔记`,
          truncated: notes.length > limit,
        })
      },
    ),

    tool(
      'getnote_create_kb',
      '创建一个新的个人知识库。',
      S.object({
        name: S.string('知识库名称。'),
        description: S.string('可选：知识库描述。'),
      }, ['name']),
      async (args, exec) => {
        const name = argString(args, 'name', '知识库名称')
        const description = argOptionalString(args, 'description', '知识库描述')

        const cliArgs = ['kb', 'create']
        if (description) cliArgs.push('--desc', description)
        cliArgs.push('--', name)

        const data = unwrapPayload(await runGetnote(cliArgs, runnerOptions(config, exec.signal)))
        const topic = data?.topic && typeof data.topic === 'object' ? data.topic : data
        const topicId = topic?.topic_id ?? topic?.id

        if (topicId !== undefined && topicId !== null && topicId !== '') {
          return `已创建知识库「${oneLine(topic?.name || name, 80)}」（ID: ${String(topicId)}）。`
        }
        return `知识库创建请求已完成。\n${renderKeyValues(data)}`
      },
    ),

    tool(
      'getnote_add_notes_to_kb',
      '把一条或多条已有笔记加入知识库。',
      S.object({
        topic_id: S.string('目标知识库 ID。'),
        note_ids: S.stringArray('要加入的笔记 ID 列表。', { minItems: 1, maxItems: 100 }),
      }, ['topic_id', 'note_ids']),
      async (args, exec) => {
        const topicId = argId(args, 'topic_id', '知识库 ID')
        const noteIds = argStringArray(args, 'note_ids', { min: 1, max: 100 })

        const data = unwrapPayload(await runGetnote(
          ['kb', 'add', topicId, ...noteIds],
          runnerOptions(config, exec.signal),
        ))

        const lines = [`已把 ${noteIds.length} 条笔记加入知识库 ${topicId}。`]
        if (data && typeof data === 'object') {
          const failed = data.failed ?? data.errors
          if (Array.isArray(failed) && failed.length) {
            lines.push(`失败 ${failed.length} 项：`)
            lines.push(renderKeyValues(failed))
          }
        }
        return lines.join('\n')
      },
    ),

    tool(
      'getnote_remove_notes_from_kb',
      '把一条或多条笔记从知识库移除；只解除关联，不删除笔记本身。',
      S.object({
        topic_id: S.string('知识库 ID。'),
        note_ids: S.stringArray('要移除的笔记 ID 列表。', { minItems: 1, maxItems: 100 }),
      }, ['topic_id', 'note_ids']),
      async (args, exec) => {
        const topicId = argId(args, 'topic_id', '知识库 ID')
        const noteIds = argStringArray(args, 'note_ids', { min: 1, max: 100 })

        // CLI 1.8.0 requires --yes for kb remove; 1.1.1 does not know it.
        const baseArgs = ['kb', 'remove', topicId, ...noteIds]
        let data
        try {
          data = unwrapPayload(await runGetnote(
            [...baseArgs, '-y'],
            runnerOptions(config, exec.signal),
          ))
        } catch (error) {
          if (error instanceof GetnoteError && /unknown (shorthand )?flag/i.test(error.message)) {
            data = unwrapPayload(await runGetnote(baseArgs, runnerOptions(config, exec.signal)))
          } else {
            throw error
          }
        }

        const removed = data && typeof data === 'object' && Number.isInteger(data.removed_count)
          ? data.removed_count
          : noteIds.length
        const lines = [`已从知识库 ${topicId} 移除 ${removed} 条笔记（笔记本身未删除）。`]
        if (data && typeof data === 'object') {
          const failed = data.failed ?? data.errors
          if (Array.isArray(failed) && failed.length) {
            lines.push(`失败 ${failed.length} 项：`)
            lines.push(renderKeyValues(failed))
          }
        }
        return lines.join('\n')
      },
    ),

    tool(
      'getnote_task',
      '查询得到大脑异步保存任务（如网页链接保存）的处理进度。',
      S.object({
        task_id: S.string('保存任务 ID。'),
      }, ['task_id']),
      async (args, exec) => {
        const taskId = argId(args, 'task_id', '任务 ID')
        try {
          const data = unwrapPayload(await runGetnote(['task', taskId], runnerOptions(config, exec.signal)))
          return `保存任务 ${taskId}：\n${renderKeyValues(data)}`
        } catch (error) {
          if (error instanceof GetnoteError) {
            throw new GetnoteError(`没有查到保存任务 ${taskId}：${error.message}`)
          }
          throw error
        }
      },
    ),

    tool(
      'getnote_quota',
      '查看得到大脑 API 的读取 / 写入配额用量与重置时间。',
      S.object({}),
      async (_args, exec) => {
        const data = unwrapPayload(await runGetnote(['quota'], runnerOptions(config, exec.signal)))
        return renderQuota(data)
      },
    ),
  ]
}

export const inject = ['tools']

export function apply(ctx, config) {
  const resolvedConfig = normalizeConfig(config)
  ctx.effect(() => {
    const disposers = []
    try {
      for (const definition of buildTools(resolvedConfig)) {
        disposers.push(ctx.tools.register(definition))
      }

      let skills
      try {
        skills = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
      } catch {
        skills = undefined
      }
      if (skills && typeof skills.registerProvider === 'function') {
        try {
          disposers.push(skills.registerProvider(createGetnoteSkillProvider))
        } catch {
          // The guidance skill is optional; the tools stay available.
        }
      }
    } catch (error) {
      for (const dispose of disposers) dispose()
      throw error
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}
