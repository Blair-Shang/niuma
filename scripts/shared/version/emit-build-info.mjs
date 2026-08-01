#!/usr/bin/env node
/**
 * 单一版本源：读取根 package.json，生成 build/version.json，
 * 同步 web / 同级 niuma-ui / ssh-service Cargo.toml 版本字段。
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
  const cargoPath = join(repoRoot, 'services/ssh-service/Cargo.toml')
  if (!existsSync(cargoPath)) return
  const text = readFileSync(cargoPath, 'utf8')
  const next = text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
  if (next === text) return
  writeFileSync(cargoPath, next, 'utf8')
  process.stderr.write(`synced services/ssh-service/Cargo.toml -> ${version}\n`)
}

const rootPkg = readJson(join(repoRoot, 'package.json'))
const version = String(rootPkg.version || '0.0.0')
const buildId = getGitSha()
const buildDate = new Date().toISOString()

const info = {
  name: rootPkg.name || 'niuma',
  version,
  buildId,
  buildDate,
  description: rootPkg.description || '',
}

mkdirSync(join(repoRoot, 'build'), { recursive: true })
writeJson(join(repoRoot, 'build/version.json'), info)

writeFileSync(
  join(repoRoot, 'build/version.env'),
  [
    `VITE_NIUMA_VERSION=${version}`,
    `VITE_NIUMA_BUILD_ID=${buildId}`,
    `VITE_NIUMA_BUILD_DATE=${buildDate}`,
    '',
  ].join('\n'),
  'utf8',
)

syncPackageVersion('web/package.json', version)
// @niuma/ui 已迁至同级仓库 niuma-ui；存在时同步版本字段便于联调对齐
syncPackageVersion('../niuma-ui/package.json', version)
syncCargoVersion(version)

process.stdout.write(`${JSON.stringify(info)}\n`)
