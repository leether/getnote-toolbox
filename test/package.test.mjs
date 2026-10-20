import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('package manifest exposes the runtime files and bundle patch', () => {
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, './index.js')
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.engines.node, '>=20')
  assert.ok(manifest.peerDependencies['@deepseek-ai/schemastery'])
})

test('packaged files exist and LICENSE/CHANGELOG are shipped', () => {
  for (const file of [
    'index.js',
    'cordis.patch.yml',
    'icon.svg',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'locale/en.json',
    'locale/zh.json',
  ]) {
    assert.ok(existsSync(join(root, file)), `missing ${file}`)
  }

  for (const file of [
    'index.js',
    'cordis.patch.yml',
    'locale/*.json',
    'icon.svg',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
  ]) {
    assert.ok(manifest.files.includes(file), `${file} is not in package.json files`)
  }

})

test('locale metadata is complete', () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8'))
    assert.equal(typeof data.meta.title, 'string')
    assert.ok(data.meta.title.trim().length > 0)
    assert.equal(typeof data.meta.description, 'string')
    assert.ok(data.meta.description.trim().length > 0)
  }
})

test('bundle patch inserts the expected row', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*getnote-toolbox/)
  assert.match(patch, /name:\s*'@leether\/getnote-toolbox'/)
  assert.match(patch, /inject:\s*\[tools\]/)
})

test('icon is a small SVG', () => {
  const icon = readFileSync(join(root, 'icon.svg'), 'utf8')
  assert.match(icon, /^\s*<svg[\s>]/)
  assert.ok(statSync(join(root, 'icon.svg')).size < 256 * 1024)
})
