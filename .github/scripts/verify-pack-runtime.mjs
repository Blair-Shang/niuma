#!/usr/bin/env node
/**
 * 校验打包产物含 CEF 运行时资源。缺 resources.pak 时 Windows 安装后会刷 GPU / 位图错误。
 * Usage: node verify-pack-runtime.mjs <output-dir>
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const root = process.argv[2]
if (!root) {
  process.stderr.write('usage: verify-pack-runtime.mjs <output-dir>\n')
  process.exit(1)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) {
    return acc
  }
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

function mustExist(path, label) {
  if (!existsSync(path)) {
    fail(`missing ${label}: ${path}`)
  }
}

const files = walk(root)
const artifact = basename(root)

if (artifact.startsWith('windows-')) {
  const dir = join(root, 'dir')
  for (const name of [
    'niuma.exe',
    'libcef.dll',
    'chrome_elf.dll',
    'resources.pak',
    'chrome_100_percent.pak',
    'icudtl.dat',
  ]) {
    mustExist(join(dir, name), name)
  }
  const localeZh = join(dir, 'locales', 'zh-CN.pak')
  const localeEn = join(dir, 'locales', 'en-US.pak')
  if (!existsSync(localeZh) && !existsSync(localeEn)) {
    fail(`missing locales pak under ${join(dir, 'locales')}`)
  }
} else if (artifact.startsWith('linux-')) {
  const deb = files.find((file) => file.endsWith('.deb'))
  if (!deb) {
    fail(`no .deb under ${root}`)
  }
  const listing = execFileSync('dpkg-deb', ['-c', deb], { encoding: 'utf8' })
  for (const name of [
    'resources.pak',
    'chrome_100_percent.pak',
    'libcef.so',
    'icudtl.dat',
    'v8_context_snapshot.bin',
    'libEGL.so',
    'libGLESv2.so',
  ]) {
    if (!listing.includes(name)) {
      fail(`deb missing ${name}: ${deb}`)
    }
  }
} else if (artifact.startsWith('macos-')) {
  const pak = files.find((file) => basename(file) === 'resources.pak')
  if (!pak) {
    fail(`missing resources.pak under ${root}`)
  }
  mustExist(join(pak, '..', 'chrome_100_percent.pak'), 'chrome_100_percent.pak')
  mustExist(join(pak, '..', 'icudtl.dat'), 'icudtl.dat')
  const helper = files.find((file) => file.replaceAll('\\', '/').includes('/NiuMa Helper.app/'))
  if (!helper) {
    fail(`missing NiuMa Helper.app under ${root}`)
  }
  const framework = files.find((file) =>
    file.replaceAll('\\', '/').includes('/Chromium Embedded Framework.framework/'),
  )
  if (!framework) {
    fail(`missing Chromium Embedded Framework.framework under ${root}`)
  }
} else {
  fail(`unknown artifact dir: ${artifact}`)
}

process.stdout.write(`CEF runtime ok -> ${root}\n`)
