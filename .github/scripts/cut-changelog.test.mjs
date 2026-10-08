import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { planRelease, promote, publishedSet, sectionNotes } from './cut-changelog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const script = path.join(root, '.github/scripts/cut-changelog.mjs')

const sample = `# Changelog

说明。

## [Unreleased]

### 修复

- 流水线按 changelog 自动发版。

## [1.1.6] - 2026-09-24

### 新增

- 已有条目。
`

test('plans the package version when Unreleased has list items', () => {
  assert.equal(planRelease(sample, publishedSet('1.1.6'), '1.1.7'), '1.1.7')
})

test('skips a version that already has a tag', () => {
  assert.equal(planRelease(sample, publishedSet('v1.1.7,1.1.6'), '1.1.7'), '')
})

test('skips when there is no list item', () => {
  const text = `## [Unreleased]\n\n### 修复\n\n## [1.1.6] - 2026-09-24\n\n- 旧条目。\n`
  assert.equal(planRelease(text, publishedSet('1.1.6'), '1.1.7'), '')
})

test('moves Unreleased list items into a dated version section', () => {
  const next = promote(sample, '1.1.7', '2026-10-08')
  assert.match(next, /## \[Unreleased\]\n\n## \[1\.1\.7\] - 2026-10-08\n\n### 修复\n\n- 流水线按 changelog 自动发版。\n\n## \[1\.1\.6\] - 2026-09-24/)
  assert.equal(promote(next, '1.1.7', '2026-10-09'), next)
  assert.match(sectionNotes(next, '1.1.7'), /流水线按 changelog 自动发版/)
})

test('leaves the tagged 1.1.6 section untouched and plans the next version from Unreleased', () => {
  const original = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  assert.equal(promote(original, '1.1.6', '2026-10-08'), original)
  assert.equal(planRelease(original, publishedSet('1.1.6'), '1.1.6'), '')
  assert.equal(planRelease(original, publishedSet('1.1.6'), '1.1.7'), '1.1.7')
  const next = promote(original, '1.1.7', '2026-10-08')
  assert.match(next, /## \[1\.1\.7\] - 2026-10-08\n\n### 修复\n\n- SSH 终端/)
  assert.match(next, /## \[1\.1\.6\] - 2026-09-24/)
  assert.doesNotMatch(next.split('## [1.1.7]')[0], /切换 SFTP/)
  assert.equal(promote(next, '1.1.7', '2026-10-09'), next)
})

test('plan command prints only the version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-changelog-'))
  const changelog = path.join(dir, 'CHANGELOG.md')
  fs.writeFileSync(changelog, sample, 'utf8')
  const result = spawnSync(
    process.execPath,
    [script, 'plan', '--version', '1.1.7', '--published', '1.1.6', '--date', '2026-10-08', '--changelog', changelog],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '1.1.7\n')
  assert.equal(fs.readFileSync(changelog, 'utf8'), sample)
})
