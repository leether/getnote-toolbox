import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const files = [
  'index.js',
  'scripts/check.mjs',
  'scripts/smoke.mjs',
  'test/plugin.test.mjs',
  'test/package.test.mjs',
  'test/fixtures/fake-getnote.mjs',
]

const missing = files.filter(file => !existsSync(file))
if (missing.length) {
  console.error(`missing files: ${missing.join(', ')}`)
  process.exit(1)
}

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}

console.log(`syntax OK: ${files.length} files`)
