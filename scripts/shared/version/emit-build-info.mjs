#!/usr/bin/env node
/**
 * 单一版本源：读取根 package.json，生成 build/version.json，
 * 同步 web 与 ssh-service / sftp-service Cargo.toml 版本字段。
 * niuma-ui 为独立仓与独立 SemVer，禁止改写其 package.json。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '../../..')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

function getCommitCount() {
  try {
    const raw = execSync('git rev-list --count HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.min(n, 65535)
  } catch {
    return 0
  }
}

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not semver (x.y.z): ${version}`)
  }
}

function assertReleaseTag(version) {
  const ref = process.env.GITHUB_REF || ''
  if (!ref.startsWith('refs/tags/')) return
  const tag = process.env.GITHUB_REF_NAME || ref.slice('refs/tags/'.length)
  const expected = tag.startsWith('v') ? tag.slice(1) : tag
  if (expected !== version) {
    throw new Error(`git tag ${tag} must match package.json version ${version}`)
  }
}

function publisherOf(pkg) {
  const author = pkg.author
  if (typeof author === 'string' && author.trim()) return author.trim()
  if (author && typeof author === 'object' && author.name) return String(author.name)
  return 'NiuMa'
}

function syncPackageVersion(relPath, version) {
  const abs = join(repoRoot, relPath)
  if (!existsSync(abs)) return
  const pkg = readJson(abs)
  if (pkg.version === version) return
  pkg.version = version
  writeJson(abs, pkg)
  process.stderr.write(`synced ${relPath} -> ${version}\n`)
}

function syncCargoVersion(version) {
  for (const rel of ['services/ssh-service/Cargo.toml', 'services/sftp-service/Cargo.toml']) {
    const cargoPath = join(repoRoot, rel)
    if (!existsSync(cargoPath)) continue
    const text = readFileSync(cargoPath, 'utf8')
    const next = text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
    if (next === text) continue
    writeFileSync(cargoPath, next, 'utf8')
    process.stderr.write(`synced ${rel} -> ${version}\n`)
  }
}

const rootPkg = readJson(join(repoRoot, 'package.json'))
const version = String(rootPkg.version || '1.0.0')
assertSemver(version)
assertReleaseTag(version)
const buildId = getGitSha()
const buildNumber = getCommitCount()
const buildDate = new Date().toISOString()
const channel = String(process.env.NIUMA_CHANNEL || 'stable').trim() || 'stable'

const info = {
  name: rootPkg.name || 'niuma',
  version,
  channel,
  buildId,
  buildNumber,
  buildDate,
  publisher: publisherOf(rootPkg),
  homepage: String(rootPkg.homepage || 'https://www.niuma007.com'),
  description: rootPkg.description || '',
}

mkdirSync(join(repoRoot, 'build'), { recursive: true })
writeJson(join(repoRoot, 'build/version.json'), info)

syncPackageVersion('web/package.json', version)
syncCargoVersion(version)

process.stdout.write(`${JSON.stringify(info)}\n`)
