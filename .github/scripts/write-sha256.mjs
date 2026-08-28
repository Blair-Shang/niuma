#!/usr/bin/env node
/**
 * Write SHA256SUMS.txt for installer-like files under a directory.
 * Usage: node write-sha256.mjs <output-dir>
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2]
if (!root) {
  process.stderr.write('usage: write-sha256.mjs <output-dir>\n')
  process.exit(1)
}

const keep = /\.(exe|deb|rpm|run|pkg|dmg|zip|app)$/i

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, acc)
    } else {
      acc.push(full)
    }
  }
  return acc
}

const files = walk(root)
  .filter((file) => keep.test(file) && !file.endsWith('SHA256SUMS.txt'))
  .sort((a, b) => a.localeCompare(b))

const lines = files.map((file) => {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  const rel = relative(root, file).replaceAll('\\', '/')
  return `${hash}  ${rel}`
})

const out = join(root, 'SHA256SUMS.txt')
writeFileSync(out, `${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8')
process.stdout.write(`wrote ${lines.length} checksums -> ${out}\n`)
