#!/usr/bin/env node
/**
 * Write SHA256SUMS.txt for installer-like files under a directory.
 * Usage: node write-sha256.mjs <output-dir>
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const root = process.argv[2]
if (!root) {
  process.stderr.write('usage: write-sha256.mjs <output-dir>\n')
  process.exit(1)
}

// 只校验用户安装包。绿色目录里的 niuma.exe / 服务 exe 不进清单。
function isReleaseInstaller(file) {
  const name = basename(file)
  if (/^NiuMa-.+-Setup\.(exe|run|pkg)$/i.test(name)) return true
  if (/^NiuMa-.+\.dmg$/i.test(name)) return true
  if (/\.(deb|rpm)$/i.test(name)) return true
  return false
}

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
  .filter((file) => isReleaseInstaller(file))
  .sort((a, b) => a.localeCompare(b))

const lines = files.map((file) => {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  const rel = relative(root, file).replaceAll('\\', '/')
  return `${hash}  ${rel}`
})

const out = join(root, 'SHA256SUMS.txt')
writeFileSync(out, `${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8')
process.stdout.write(`wrote ${lines.length} checksums -> ${out}\n`)
