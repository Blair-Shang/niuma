/** 剪贴板读写封装：浏览器 Clipboard API 优先，CEF Shell Bridge 最后兜底。
 *  CEF 壳层通过 CefPermissionHandler 自动放行 CEF_PERMISSION_TYPE_CLIPBOARD，
 *  避免 Alloy 默认 IGNORE；Shell Bridge 仅在 API 仍失败时使用。
 */

type CefQueryFn = (req: {
  request: string
  onSuccess: (response: string) => void
  onFailure: (code: number, message: string) => void
}) => void

function bridgeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getCefQuery(): CefQueryFn | null {
  const fn = (globalThis as { cefQuery?: CefQueryFn }).cefQuery
  return typeof fn === 'function' ? fn : null
}

async function bridgeInvokeClipboard<T>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const cefQuery = getCefQuery()
  if (!cefQuery) {
    return null
  }
  return new Promise((resolve) => {
    cefQuery({
      request: JSON.stringify({ method, params, id: bridgeRequestId() }),
      onSuccess: (response) => {
        try {
          resolve(JSON.parse(response) as T)
        } catch {
          resolve(null)
        }
      },
      onFailure: () => resolve(null),
    })
  })
}

async function readClipboardViaShell(): Promise<string | null> {
  const result = await bridgeInvokeClipboard<{ text?: string }>('shell.clipboard.readText')
  const text = result?.text
  return text ? text : null
}

async function writeClipboardViaShell(text: string): Promise<boolean> {
  const result = await bridgeInvokeClipboard<{ written?: boolean }>('shell.clipboard.writeText', { text })
  return Boolean(result?.written)
}

let prefetchedText: string | null = null
let prefetchAt = 0
let prefetchPromise: Promise<void> | null = null
let readApiBlocked = false
let writeApiBlocked = false
let permissionStateProbed = false

const PREFETCH_TTL_MS = 10_000

function isClipboardPermissionDeniedError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
}

function markReadApiBlocked(err?: unknown): void {
  if (err === undefined || isClipboardPermissionDeniedError(err)) {
    readApiBlocked = true
  }
}

function markWriteApiBlocked(err?: unknown): void {
  if (err === undefined || isClipboardPermissionDeniedError(err)) {
    writeApiBlocked = true
  }
}

async function syncClipboardPermissionState(): Promise<void> {
  if (permissionStateProbed) {
    return
  }
  permissionStateProbed = true
  if (!navigator.permissions?.query) {
    return
  }
  try {
    const read = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
    if (read.state === 'denied') {
      readApiBlocked = true
    }
    read.onchange = () => {
      readApiBlocked = read.state === 'denied'
    }
  } catch {
    // clipboard-read permission query 并非所有环境都支持
  }
  try {
    const write = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })
    if (write.state === 'denied') {
      writeApiBlocked = true
    }
    write.onchange = () => {
      writeApiBlocked = write.state === 'denied'
    }
  } catch {
    // ignore
  }
}

/** 在 contextmenu 等仍持有用户手势时预读剪贴板，供稍后菜单项点击使用 */
export async function prefetchClipboardText(): Promise<void> {
  prefetchedText = null
  prefetchAt = Date.now()
  await syncClipboardPermissionState()
  if (!readApiBlocked) {
    const fromReadText = await readClipboardViaReadText()
    if (fromReadText) {
      prefetchedText = fromReadText
      return
    }
    const fromItems = await readClipboardViaItems()
    if (fromItems) {
      prefetchedText = fromItems
      return
    }
  }
  const fromShell = await readClipboardViaShell()
  if (fromShell) {
    prefetchedText = fromShell
  }
}

/** 启动预读并返回 promise，菜单点击粘贴前应 await */
export function beginClipboardPrefetch(): Promise<void> {
  prefetchPromise = prefetchClipboardText().finally(() => {
    prefetchPromise = null
  })
  return prefetchPromise
}

export async function waitClipboardPrefetch(): Promise<void> {
  if (prefetchPromise) {
    await prefetchPromise
  }
}

function takePrefetchedText(): string | null {
  if (!prefetchedText || Date.now() - prefetchAt > PREFETCH_TTL_MS) {
    prefetchedText = null
    return null
  }
  const text = prefetchedText
  prefetchedText = null
  return text
}

export async function readClipboardText(): Promise<string | null> {
  await waitClipboardPrefetch()
  const cached = takePrefetchedText()
  if (cached) {
    return cached
  }
  await syncClipboardPermissionState()
  if (!readApiBlocked) {
    const fromReadText = await readClipboardViaReadText()
    if (fromReadText) {
      return fromReadText
    }
    const fromItems = await readClipboardViaItems()
    if (fromItems) {
      return fromItems
    }
  }
  return readClipboardViaShell()
}

async function readClipboardViaReadText(): Promise<string | null> {
  if (readApiBlocked || !navigator.clipboard?.readText) {
    return null
  }
  try {
    const text = await navigator.clipboard.readText()
    return text || null
  } catch (err) {
    markReadApiBlocked(err)
    return null
  }
}

/** readText 失败时尝试 clipboard.read() 取 text/plain（CEF 部分场景更稳） */
async function readClipboardViaItems(): Promise<string | null> {
  if (readApiBlocked || !navigator.clipboard?.read) {
    return null
  }
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      if (!item.types.includes('text/plain')) {
        continue
      }
      const blob = await item.getType('text/plain')
      const text = await blob.text()
      if (text) {
        return text
      }
    }
  } catch (err) {
    markReadApiBlocked(err)
    return null
  }
  return null
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text || writeApiBlocked || !navigator.clipboard?.writeText) {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    markWriteApiBlocked(err)
    return false
  }
}

/** execCommand 兜底：CEF / 无 Clipboard API 权限时菜单复制仍可用 */
export function copyTextWithExecCommand(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

/** 写入系统剪贴板（API 优先，execCommand 兜底） */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false
  }
  await syncClipboardPermissionState()
  if (!writeApiBlocked && (await writeClipboardText(text))) {
    return true
  }
  if (copyTextWithExecCommand(text)) {
    return true
  }
  return writeClipboardViaShell(text)
}

/** @internal vitest 用 */
export function __resetClipboardStateForTests(): void {
  prefetchedText = null
  prefetchAt = 0
  prefetchPromise = null
  readApiBlocked = false
  writeApiBlocked = false
  permissionStateProbed = false
}
