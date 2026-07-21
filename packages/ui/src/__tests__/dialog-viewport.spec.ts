import { afterEach, describe, expect, it } from 'vitest'
import { dialogViewportSize, readDialogViewportInsets } from '../components/dialog-viewport'

describe('dialog-viewport', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--rs-dialog-inset-top')
    document.documentElement.style.removeProperty('--rs-dialog-inset-bottom')
    document.documentElement.style.removeProperty('--rs-dialog-inset-x')
  })

  it('falls back to viewport gap when insets are unset', () => {
    const insets = readDialogViewportInsets()
    expect(insets.top).toBe(16)
    expect(insets.bottom).toBe(16)
    expect(insets.left).toBe(16)
    expect(insets.right).toBe(16)
  })

  it('reads inset tokens from document root', () => {
    document.documentElement.style.setProperty('--rs-dialog-inset-top', '40px')
    document.documentElement.style.setProperty('--rs-dialog-inset-bottom', '26px')
    document.documentElement.style.setProperty('--rs-dialog-inset-x', '12px')
    const insets = readDialogViewportInsets()
    expect(insets.top).toBe(40)
    expect(insets.bottom).toBe(26)
    expect(insets.left).toBe(12)
    expect(insets.right).toBe(12)
  })

  it('subtracts insets from viewport size', () => {
    document.documentElement.style.setProperty('--rs-dialog-inset-top', '40px')
    document.documentElement.style.setProperty('--rs-dialog-inset-bottom', '26px')
    document.documentElement.style.setProperty('--rs-dialog-inset-x', '10px')
    const size = dialogViewportSize()
    expect(size.width).toBe(window.innerWidth - 20)
    expect(size.height).toBe(window.innerHeight - 66)
  })
})
