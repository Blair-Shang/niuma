import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetClipboardStateForTests,
  beginClipboardPrefetch,
  copyTextToClipboard,
  copyTextWithExecCommand,
  readClipboardText,
  writeClipboardText,
} from '../utils/rs-clipboard'

function stubNavigator(clipboard: Record<string, unknown>): void {
  vi.stubGlobal('navigator', {
    clipboard,
    permissions: {
      query: vi.fn().mockResolvedValue({ state: 'granted', onchange: null }),
    },
  })
}

describe('rs-clipboard', () => {
  afterEach(() => {
    __resetClipboardStateForTests()
    vi.restoreAllMocks()
  })

  it('uses prefetched text when menu opens before paste', async () => {
    const readText = vi.fn().mockResolvedValue('from-windows')
    vi.stubGlobal('navigator', {
      clipboard: { readText, writeText: vi.fn() },
    })
    await beginClipboardPrefetch()
    expect(readText).toHaveBeenCalledTimes(1)
    await expect(readClipboardText()).resolves.toBe('from-windows')
    expect(readText).toHaveBeenCalledTimes(1)
  })

  it('waits for in-flight prefetch before paste', async () => {
    let resolveRead: (value: string) => void = () => undefined
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        }),
    )
    vi.stubGlobal('navigator', {
      clipboard: { readText, writeText: vi.fn() },
    })
    const pending = beginClipboardPrefetch()
    await Promise.resolve()
    const readPromise = readClipboardText()
    resolveRead('late-text')
    await pending
    await expect(readPromise).resolves.toBe('late-text')
  })

  it('writes clipboard text via API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(), writeText } })
    await expect(writeClipboardText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when writeText fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(), writeText } })
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
        remove: vi.fn(),
      }),
      execCommand,
    })
    await expect(copyTextToClipboard('fallback')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back to shell bridge when clipboard read fails', async () => {
    const readText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const cefQuery = vi.fn(({ onSuccess }: { onSuccess: (r: string) => void }) => {
      onSuccess(JSON.stringify({ text: 'from-shell' }))
    })
    vi.stubGlobal('cefQuery', cefQuery)
    vi.stubGlobal('navigator', {
      clipboard: { readText, writeText: vi.fn() },
    })
    await beginClipboardPrefetch()
    await expect(readClipboardText()).resolves.toBe('from-shell')
    expect(cefQuery).toHaveBeenCalled()
    expect(readText).toHaveBeenCalledTimes(1)
    await expect(readClipboardText()).resolves.toBe('from-shell')
    expect(readText).toHaveBeenCalledTimes(1)
  })

  it('writes via shell bridge only when API and execCommand fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn().mockReturnValue(false)
    const cefQuery = vi.fn(({ request, onSuccess }: { request: string; onSuccess: (r: string) => void }) => {
      const payload = JSON.parse(request) as { method: string }
      expect(payload.method).toBe('shell.clipboard.writeText')
      onSuccess(JSON.stringify({ written: true }))
    })
    vi.stubGlobal('cefQuery', cefQuery)
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(), writeText } })
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
        remove: vi.fn(),
      }),
      execCommand,
    })
    await expect(copyTextToClipboard('cef-copy')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(cefQuery).toHaveBeenCalled()
  })

  it('copyTextWithExecCommand uses textarea trick', () => {
    const execCommand = vi.fn().mockReturnValue(true)
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
        remove: vi.fn(),
      }),
      execCommand,
    })
    expect(copyTextWithExecCommand('line')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
