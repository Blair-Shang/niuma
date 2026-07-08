import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import RsTerminal from '../components/RsTerminal.vue'
import { buildAnsiColorDemo, normalizeTerminalHexColor, resolveTerminalTheme } from '../components/terminal-utils'
import { readDocumentTheme } from '../components/code-editor-utils'

vi.mock('../utils/rs-clipboard', () => ({
  beginClipboardPrefetch: vi.fn(),
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
  readClipboardText: vi.fn().mockResolvedValue('pasted'),
}))

const fitMock = vi.fn()
const writeMock = vi.fn()
const clearMock = vi.fn()
const focusMock = vi.fn()
const disposeMock = vi.fn()
const selectAllMock = vi.fn()
const clearSelectionMock = vi.fn()
const hasSelectionMock = vi.fn(() => false)
const getSelectionMock = vi.fn(() => '')
const onDataHandlers: Array<(data: string) => void> = []
const onSelectionHandlers: Array<() => void> = []
const onRenderHandlers: Array<() => void> = []
const onScrollHandlers: Array<() => void> = []
let pasteMock = vi.fn()
let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null

const bufferMock = {
  baseY: 0,
  cursorY: 0,
  viewportY: 0,
  length: 1,
}

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = fitMock
    proposeDimensions = () => ({ cols: 80, rows: 24 })
  },
}))

vi.mock('xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    buffer = {
      active: bufferMock,
    }
    loadAddon() {
      return undefined
    }
    open() {
      return undefined
    }
    onData(handler: (data: string) => void) {
      onDataHandlers.push(handler)
    }
    onSelectionChange(handler: () => void) {
      onSelectionHandlers.push(handler)
    }
    onRender(handler: () => void) {
      onRenderHandlers.push(handler)
      return { dispose: vi.fn() }
    }
    onScroll(handler: () => void) {
      onScrollHandlers.push(handler)
      return { dispose: vi.fn() }
    }
    registerMarker() {
      return { dispose: vi.fn() }
    }
    registerDecoration() {
      return { dispose: vi.fn() }
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      keyEventHandler = handler
    }
    hasSelection = hasSelectionMock
    getSelection = getSelectionMock
    selectAll = selectAllMock
    clearSelection = clearSelectionMock
    paste = pasteMock
    element = document.createElement('div')
    write = writeMock
    clear = clearMock
    focus = focusMock
    dispose = disposeMock
  },
}))

beforeAll(() => {
  class ResizeObserverMock {
    observe() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

describe('terminal-utils', () => {
  it('builds ansi color demo text', () => {
    const demo = buildAnsiColorDemo()
    expect(demo).toContain('ANSI 16 colors')
    expect(demo).toContain('\x1b[31m')
  })

  it('resolves document theme', () => {
    document.documentElement.dataset.rsTheme = 'light'
    expect(resolveTerminalTheme('auto')).toBe('light')
    document.documentElement.dataset.rsTheme = 'dark'
    expect(resolveTerminalTheme('auto')).toBe('dark')
  })

  it('normalizes terminal hex colors', () => {
    expect(normalizeTerminalHexColor('#181818')).toBe('#181818')
    expect(normalizeTerminalHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeTerminalHexColor('rgb(246, 246, 246)')).toBe('#f6f6f6')
    expect(normalizeTerminalHexColor('rgb(248 248 248)')).toBe('#f8f8f8')
    expect(normalizeTerminalHexColor('rgb(0 0 0)')).toBe('#000000')
  })

  it('detects tui refresh sequences', async () => {
    const { containsTuiRefreshSequence } = await import('../components/terminal-utils')
    expect(containsTuiRefreshSequence('\x1b[2J')).toBe(true)
    expect(containsTuiRefreshSequence('\x1b[1;1H')).toBe(true)
    expect(containsTuiRefreshSequence('plain log line')).toBe(false)
  })

  it('detects full screen clear sequences', async () => {
    const { containsFullScreenClear, startsWithCursorHome } = await import('../components/terminal-utils')
    expect(containsFullScreenClear('\x1b[2J')).toBe(true)
    expect(containsFullScreenClear('\x1b[2;0H')).toBe(false)
    expect(startsWithCursorHome('\x1b[Hsummary')).toBe(true)
    expect(startsWithCursorHome(' \x1b[1;1H')).toBe(true)
    expect(startsWithCursorHome('process line')).toBe(false)
  })
})

describe('RsTerminal', () => {
  beforeEach(() => {
    pasteMock.mockClear()
    selectAllMock.mockClear()
    keyEventHandler = null
  })

  it('renders overlay text', () => {
    const wrapper = mount(RsTerminal, {
      props: {
        overlay: '连接中...',
      },
    })
    expect(wrapper.find('.rs-terminal__overlay').text()).toContain('连接中...')
  })

  it('emits terminal input data', async () => {
    const wrapper = mount(RsTerminal)
    await nextTick()
    onDataHandlers.at(-1)?.('ls\r')
    expect(wrapper.emitted('data')?.[0]).toEqual(['ls\r'])
  })

  it('exposes terminal helpers', async () => {
    const wrapper = mount(RsTerminal)
    await nextTick()
    wrapper.vm.write('pwd\r\n')
    wrapper.vm.clear()
    wrapper.vm.focus()
    wrapper.vm.selectAll()
    expect(writeMock).toHaveBeenCalledWith('pwd\r\n')
    expect(clearMock).toHaveBeenCalled()
    expect(focusMock).toHaveBeenCalled()
    expect(selectAllMock).toHaveBeenCalled()
  })

  it('handles select-all shortcut', async () => {
    mount(RsTerminal, { props: { shortcuts: true } })
    await nextTick()
    const handled = keyEventHandler?.({
      type: 'keydown',
      metaKey: true,
      ctrlKey: false,
      key: 'a',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent)
    expect(handled).toBe(false)
    expect(selectAllMock).toHaveBeenCalledTimes(1)
  })

  it('pastes once on ctrl+v keydown and ignores keyup', async () => {
    mount(RsTerminal, { props: { shortcuts: true } })
    await nextTick()
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    keyEventHandler?.({
      type: 'keydown',
      ctrlKey: true,
      key: 'v',
      preventDefault,
      stopPropagation,
    } as unknown as KeyboardEvent)
    keyEventHandler?.({
      type: 'keyup',
      ctrlKey: true,
      key: 'v',
    } as unknown as KeyboardEvent)
    await nextTick()
    expect(pasteMock).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })
})
