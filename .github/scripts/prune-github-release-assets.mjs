#!/usr/bin/env node
/**
 * 只删除过旧 GitHub Release 上的上传 asset，保留 release 页、tag 与说明。
 * Usage: node prune-github-release-assets.mjs [keep]
 *
 * 默认保留最近 3 个已发布的 v* 版本。不必在仓库里配 Secret / Variable：
 * Actions 会注入 GITHUB_REPOSITORY；token 用步骤里的 github.token 即可。
 */
const keep = parseKeep(process.argv[2])
const repo = (process.env.GITHUB_REPOSITORY || '').trim()
const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
if (!repo || !repo.includes('/')) {
  process.stderr.write('GITHUB_REPOSITORY is required (owner/repo).\n')
  process.exit(1)
}
if (!token) {
  process.stderr.write('GITHUB_TOKEN is required.\n')
  process.exit(1)
}

const releases = (await listPublishedReleases()).sort((a, b) =>
  String(b.published_at || '').localeCompare(String(a.published_at || '')),
)
if (releases.length <= keep) {
  process.stdout.write(`keep ${keep}: only ${releases.length} published release(s), nothing to prune.\n`)
  process.exit(0)
}

const retained = releases.slice(0, keep)
const stale = releases.slice(keep)
process.stdout.write(
  `keep ${keep}: ${retained.map((r) => r.tag_name).join(', ')}\n` +
    `prune assets: ${stale.map((r) => r.tag_name).join(', ')}\n`,
)

let deleted = 0
let failed = 0
for (const rel of stale) {
  const assets = Array.isArray(rel.assets) ? rel.assets : []
  if (assets.length === 0) {
    process.stdout.write(`${rel.tag_name}: no assets\n`)
    continue
  }
  // 同一 release 内串行删除，避免打同一资源；不同文件本身很快。
  for (const asset of assets) {
    try {
      await api('DELETE', `/repos/${repo}/releases/assets/${asset.id}`)
      deleted += 1
      process.stdout.write(`deleted ${rel.tag_name} ${asset.name} (${formatBytes(asset.size)})\n`)
    } catch (err) {
      failed += 1
      process.stderr.write(`failed to delete ${rel.tag_name} ${asset.name}: ${err.message}\n`)
    }
  }
}

process.stdout.write(`pruned ${deleted} asset(s), failed ${failed}\n`)
if (failed > 0) process.exit(1)

function parseKeep(raw) {
  const n = Number.parseInt(String(raw || '3'), 10)
  if (!Number.isFinite(n) || n < 1) {
    process.stderr.write('keep must be a positive integer.\n')
    process.exit(1)
  }
  return n
}

async function listPublishedReleases() {
  const rows = []
  let page = 1
  for (;;) {
    const batch = await api('GET', `/repos/${repo}/releases?per_page=100&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const row of batch) {
      if (!row.draft && /^v/i.test(row.tag_name || '')) rows.push(row)
    }
    if (batch.length < 100) break
    page += 1
  }
  return rows
}

async function api(method, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'niuma-prune-github-release-assets',
    },
  })
  if (res.status === 204) return null
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

function formatBytes(n) {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
