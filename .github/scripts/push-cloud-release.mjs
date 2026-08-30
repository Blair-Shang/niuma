#!/usr/bin/env node
/**
 * 将本 tag 的安装包上传到 niuma-cloud 本机目录，并登记 published，
 * 供官网与桌面更新从 niuma007.com 下载（不走 GitHub）。
 * Usage: node push-cloud-release.mjs <release-files-dir>
 *
 * Env:
 *   NIUMA_CLOUD_API_BASE          默认 https://www.niuma007.com/niuma/cloud
 *   NIUMA_CLOUD_PIPELINE_TOKEN    必填
 *   RELEASE_TAG                   如 v1.0.2
 *   NIUMA_CHANNEL                 Windows 渠道，默认 stable
 *   NIUMA_PREVIEW_CHANNEL         Linux / macOS 渠道，默认 beta（尚未稳定）
 *   CHANGELOG_PATH                可选，默认 ./CHANGELOG.md
 */
import { openAsBlob, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  process.stderr.write('usage: push-cloud-release.mjs <release-files-dir>\n')
  process.exit(1)
}

const token = (process.env.NIUMA_CLOUD_PIPELINE_TOKEN || '').trim()
if (!token) {
  process.stderr.write('NIUMA_CLOUD_PIPELINE_TOKEN is empty; skip cloud push.\n')
  process.exit(0)
}

const apiBase = (process.env.NIUMA_CLOUD_API_BASE || 'https://www.niuma007.com/niuma/cloud').replace(
  /\/$/,
  '',
)
const tag = (process.env.RELEASE_TAG || '').trim()
if (!tag) {
  process.stderr.write('RELEASE_TAG is required.\n')
  process.exit(1)
}

const version = tag.replace(/^v/i, '')
const stableChannel = process.env.NIUMA_CHANNEL || 'stable'
const previewChannel = process.env.NIUMA_PREVIEW_CHANNEL || 'beta'
const hashes = loadChecksums(dir)
const files = pickInstallers(dir)
if (files.length === 0) {
  process.stderr.write('no installer files to push.\n')
  process.exit(1)
}

const items = []
for (const file of files) {
  const name = basename(file)
  const dim = parseInstallerName(name)
  if (!dim) {
    process.stderr.write(`skip unrecognized installer: ${name}\n`)
    continue
  }
  const sha = hashes.get(name.toLowerCase())
  if (!sha) {
    process.stderr.write(`missing sha256 for ${name}\n`)
    process.exit(1)
  }
  const channel = channelForPlatform(dim.platform)
  const uploaded = await uploadAsset(file, dim, sha, channel)
  items.push({
    platform: dim.platform,
    arch: dim.arch,
    channel,
    name: uploaded.name || name,
    downloadUrl: uploaded.downloadUrl,
    sha256: uploaded.sha256 || sha,
    fileSize: uploaded.fileSize || statSync(file).size,
  })
}

if (items.length === 0) {
  process.stderr.write('no mapped installer items.\n')
  process.exit(1)
}

const notesMd = readChangelogNotes(process.env.CHANGELOG_PATH || 'CHANGELOG.md', version)
const grouped = new Map()
for (const item of items) {
  const list = grouped.get(item.channel) || []
  list.push(item)
  grouped.set(item.channel, list)
}
for (const [channel, group] of grouped) {
  await registerReleases(channel, group, notesMd)
}

function channelForPlatform(platform) {
  return platform === 'windows' ? stableChannel : previewChannel
}

async function registerReleases(channel, group, notesMd) {
  const body = {
    product: 'niuma',
    version,
    channel,
    title: `NiuMa ${version}`,
    notesMd,
    publish: true,
    items: group.map(({ platform, arch, name, downloadUrl, sha256, fileSize }) => ({
      platform,
      arch,
      name,
      downloadUrl,
      sha256,
      fileSize,
    })),
  }
  const url = `${apiBase}/api/v1/pipeline/releases`
  const payload = JSON.stringify(body)
  // 旧 cloud 对登记接口按 IP 冷却 2s；beta 后立刻登 stable 会 429。重试覆盖未升级的服务端。
  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: payload,
    })
    const text = await res.text()
    if (res.ok) {
      process.stdout.write(`pushed ${group.length} release(s) ${version} channel=${channel} -> ${url}\n${text}\n`)
      return
    }
    if (res.status === 429 && attempt < maxAttempts) {
      const waitMs = 2500
      process.stderr.write(`cloud push 429 channel=${channel}, retry in ${waitMs}ms (${attempt}/${maxAttempts})\n`)
      await sleep(waitMs)
      continue
    }
    process.stderr.write(`cloud push failed ${res.status} channel=${channel}: ${text}\n`)
    process.exit(1)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function uploadAsset(file, dim, sha, channel) {
  const blob = await openAsBlob(file)
  const form = new FormData()
  form.set('file', blob, basename(file))
  form.set('product', 'niuma')
  form.set('channel', channel)
  form.set('platform', dim.platform)
  form.set('arch', dim.arch)
  form.set('version', version)
  form.set('sha256', sha)
  const assetURL = `${apiBase}/api/v1/pipeline/releases/assets`
  process.stdout.write(`uploading ${basename(file)} (${statSync(file).size} bytes) -> ${assetURL}\n`)
  const res = await fetch(assetURL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    process.stderr.write(`cloud upload failed ${res.status}: ${text}\n`)
    process.exit(1)
  }
  let parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    process.stderr.write(`cloud upload returned non-json: ${text}\n`)
    process.exit(1)
  }
  process.stdout.write(`uploaded ${basename(file)} -> ${parsed.downloadUrl || ''}\n`)
  return parsed
}

function loadChecksums(root) {
  const map = new Map()
  const sums = join(root, 'SHA256SUMS.txt')
  if (!existsSync(sums)) return map
  for (const line of readFileSync(sums, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(?:.*\/)?([^/\s]+)\s*$/)
    if (m) map.set(m[2].toLowerCase(), m[1].toLowerCase())
  }
  return map
}

function pickInstallers(root) {
  const names = readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isFile())
  const chosen = new Map()
  for (const file of names) {
    const dim = parseInstallerName(basename(file))
    if (!dim) continue
    const key = `${dim.platform}/${dim.arch}`
    const prev = chosen.get(key)
    if (!prev || installerRank(file) > installerRank(prev)) {
      chosen.set(key, file)
    }
  }
  return [...chosen.values()]
}

function installerRank(file) {
  const n = basename(file).toLowerCase()
  if (n.endsWith('-setup.exe')) return 50
  if (n.endsWith('-setup.pkg')) return 40
  if (n.endsWith('-setup.run')) return 30
  if (n.endsWith('.dmg')) return 20
  if (n.endsWith('.deb')) return 15
  if (n.endsWith('.rpm')) return 10
  return 1
}

function parseInstallerName(name) {
  let m = name.match(
    /^NiuMa-(.+)-(windows|linux|macos|kylin)-(x64|arm64)-Setup\.(exe|run|pkg)$/i,
  )
  if (m) {
    return { version: m[1], platform: normalizePlatform(m[2]), arch: m[3].toLowerCase() }
  }
  m = name.match(/^NiuMa-(.+)-(windows|linux|macos|kylin)-(x64|arm64)\.(dmg|deb|rpm)$/i)
  if (m) {
    return { version: m[1], platform: normalizePlatform(m[2]), arch: m[3].toLowerCase() }
  }
  return null
}

function normalizePlatform(p) {
  p = p.toLowerCase()
  if (p === 'kylin') return 'linux'
  return p
}

function readChangelogNotes(path, version) {
  if (!existsSync(path)) return ''
  const src = readFileSync(path, 'utf8')
  const safe = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^## \\[v?${safe}\\][^\\n]*\\n([\\s\\S]*?)(?=^## |$)`, 'm')
  const m = src.match(re)
  return m ? m[1].trim() : ''
}
