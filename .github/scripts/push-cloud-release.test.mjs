import assert from 'node:assert/strict'
import { test } from 'node:test'

import { releaseNotesFromChangelog } from './push-cloud-release.mjs'

test('keeps the version list for the cloud release notes', () => {
  const text = [
    '## [Unreleased]',
    '',
    '## [1.1.7] - 2026-10-08',
    '',
    '### 修复',
    '',
    '- SSH 终端文字不再变灰',
    '',
    '## [1.1.6] - 2026-09-24',
    '',
    '- 旧条目。',
    '',
  ].join('\n')
  assert.equal(
    releaseNotesFromChangelog(text, '1.1.7'),
    '### 修复\n\n- SSH 终端文字不再变灰',
  )
})
