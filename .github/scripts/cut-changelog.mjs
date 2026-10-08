/**
 * 按 package.json 版本把 CHANGELOG 的 [Unreleased] 收成带日期的版本段。
 *
 *   node .github/scripts/cut-changelog.mjs plan --version 1.1.7 --published 1.1.6 --date 2026-10-08
 *   node .github/scripts/cut-changelog.mjs apply --version 1.1.7 --date 2026-10-08
 *   node .github/scripts/cut-changelog.mjs notes --version 1.1.7 --notes release-notes.md
 *
 * plan 只把要发布的版本打印到 stdout（没有则打印空行），不改文件。
 * apply 在需要时写回 CHANGELOG.md；版本段已齐、且没有可搬移的列表条目时，文件字节保持原样。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SEMVER = /^\d+\.\d+\.\d+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const NOTE = /^\s*[-*]\s+\S/

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function publishedSet(raw) {
  const found = new Set()
  for (const item of String(raw ?? '').split(',')) {
    let value = item.trim()
    if (value.startsWith('v')) value = value.slice(1)
    if (SEMVER.test(value)) found.add(value)
  }
  return found
}

function splitSection(text, title) {
  const re = new RegExp(`^## \\[${escapeRegExp(title)}\\]([^\\n]*)\\n`, 'm')
  const match = re.exec(text)
  if (!match) return null
  const headingStart = match.index
  const bodyStart = headingStart + match[0].length
  const rest = text.slice(bodyStart)
  const nextRel = rest.search(/^## \[/m)
  const bodyEnd = nextRel === -1 ? text.length : bodyStart + nextRel
  return {
    headingStart,
    bodyStart,
    bodyEnd,
    suffix: match[1],
    body: text.slice(bodyStart, bodyEnd),
  }
}

function hasNotes(body) {
  return body.split('\n').some((line) => NOTE.test(line))
}

export function planRelease(text, published, version) {
  version = version.trim()
  if (!SEMVER.test(version)) {
    throw new Error('package.json version must be x.y.z')
  }
  if (published.has(version)) return ''
  const src = normalize(text)
  const unreleased = splitSection(src, 'Unreleased')
  const current = splitSection(src, version)
  if (unreleased && hasNotes(unreleased.body)) return version
  if (current && hasNotes(current.body)) return version
  return ''
}

function insertUnreleased(text) {
  const block = '## [Unreleased]\n\n'
  const idx = text.search(/^## \[/m)
  if (idx === -1) {
    const base = text.replace(/\n*$/, '')
    return `${base}\n\n${block}`
  }
  return `${text.slice(0, idx)}${block}${text.slice(idx)}`
}

function insertVersionSection(text, version, date, notes) {
  const unreleased = splitSection(text, 'Unreleased')
  const heading = `## [${version}] - ${date}\n\n`
  const block = notes ? `${heading}${notes}\n\n` : heading
  if (!notes) {
    return text.slice(0, unreleased.bodyEnd) + block + text.slice(unreleased.bodyEnd)
  }
  const prefix = text.slice(0, unreleased.bodyStart) + '\n'
  const suffix = text.slice(unreleased.bodyEnd)
  return prefix + block + suffix
}

function moveNotes(text, version, notes) {
  const unreleased = splitSection(text, 'Unreleased')
  const current = splitSection(text, version)
  const withNotes =
    text.slice(0, current.bodyStart) + `\n${notes}\n\n` + text.slice(current.bodyEnd)
  return withNotes.slice(0, unreleased.bodyStart) + '\n' + withNotes.slice(unreleased.bodyEnd)
}

function ensureDate(text, version, date) {
  const current = splitSection(text, version)
  if (current.suffix.trim()) return text
  const heading = `## [${version}] - ${date}\n`
  return text.slice(0, current.headingStart) + heading + text.slice(current.bodyStart)
}

export function promote(original, version, date) {
  version = version.trim()
  date = date.trim()
  if (!SEMVER.test(version)) throw new Error('version must be x.y.z')
  if (!DATE.test(date)) throw new Error('date must be YYYY-MM-DD')

  let text = normalize(original)
  if (!splitSection(text, 'Unreleased')) text = insertUnreleased(text)

  const unreleased = splitSection(text, 'Unreleased')
  const notes = hasNotes(unreleased.body) ? unreleased.body.trim() : ''
  const current = splitSection(text, version)
  if (!current) {
    text = insertVersionSection(text, version, date, notes)
  } else {
    if (!hasNotes(current.body) && notes) text = moveNotes(text, version, notes)
    text = ensureDate(text, version, date)
  }

  if (text === normalize(original)) return original
  return text.endsWith('\n') ? text : `${text}\n`
}

export function sectionNotes(text, version) {
  version = version.trim()
  if (!SEMVER.test(version)) throw new Error('version must be x.y.z')
  const current = splitSection(normalize(text), version)
  if (!current) return ''
  return current.body.trim()
}

function parseArgs(argv) {
  const out = {
    command: argv[0] || '',
    changelog: 'CHANGELOG.md',
    published: '',
    version: '',
    date: '',
    notes: '',
  }
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`missing value for ${key}`)
    }
    const name = key.slice(2)
    if (!(name in out)) throw new Error(`unknown argument ${key}`)
    out[name] = val
    i++
  }
  return out
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return 1
  }
  if (args.command !== 'plan' && args.command !== 'apply' && args.command !== 'notes') {
    process.stderr.write('usage: cut-changelog.mjs plan|apply|notes --version x.y.z [--date YYYY-MM-DD] [--published a,b] [--notes release-notes.md] [--changelog CHANGELOG.md]\n')
    return 1
  }

  const changelogPath = path.resolve(args.changelog)
  const original = fs.readFileSync(changelogPath, 'utf8')
  if (args.command === 'plan') {
    try {
      const version = planRelease(original, publishedSet(args.published), args.version)
      process.stdout.write(`${version}\n`)
      return 0
    } catch (err) {
      process.stderr.write(`${err.message}\n`)
      return 2
    }
  }

  if (args.command === 'notes') {
    let body
    try {
      body = sectionNotes(original, args.version)
    } catch (err) {
      process.stderr.write(`${err.message}\n`)
      return 1
    }
    if (args.notes) fs.writeFileSync(path.resolve(args.notes), body ? `${body}\n` : '', 'utf8')
    process.stdout.write(body ? `${body}\n` : '')
    return 0
  }

  let next
  try {
    next = promote(original, args.version, args.date)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return 1
  }
  if (next !== original) fs.writeFileSync(changelogPath, next, 'utf8')
  process.stdout.write(`${args.version.trim()}\n`)
  return 0
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main())
}
