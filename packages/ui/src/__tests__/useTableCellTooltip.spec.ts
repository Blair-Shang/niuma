import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { useTableCellTooltip } from '../composables/useTableCellTooltip'

const Host = defineComponent({
  props: {
    delay: { type: Number, default: 0 },
  },
  setup(props) {
    const tipRef = ref<HTMLElement | null>(null)
    const { state, onPointerOver, onPointerOut, hide } = useTableCellTooltip({
      enabled: () => true,
      delay: () => props.delay,
      tipRef,
    })
    return { state, onPointerOver, onPointerOut, hide, tipRef }
  },
  template: `
    <div @pointerover="onPointerOver" @pointerout="onPointerOut">
      <span
        class="rs-table__cell-tip rs-table__ellipsis-text"
        data-rs-table-tip-mode="overflow"
        data-rs-table-tip-text="完整文本"
      >截断</span>
      <div
        v-if="state.visible"
        ref="tipRef"
        class="rs-table__shared-tip"
        :style="state.style"
      >{{ state.text }}</div>
    </div>
  `,
})

describe('useTableCellTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows tooltip only when ellipsis content overflows', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const cell = wrapper.find('.rs-table__cell-tip').element as HTMLElement
    Object.defineProperty(cell, 'scrollWidth', { value: 200, configurable: true })
    Object.defineProperty(cell, 'clientWidth', { value: 80, configurable: true })

    await wrapper.find('.rs-table__cell-tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(wrapper.find('.rs-table__shared-tip').text()).toBe('完整文本')
    wrapper.unmount()
  })

  it('hides tooltip when content does not overflow', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    await wrapper.find('.rs-table__cell-tip').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('.rs-table__shared-tip').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows header tooltip via shared layer', async () => {
    const HeaderHost = defineComponent({
      setup() {
        const tipRef = ref<HTMLElement | null>(null)
        const { state, onPointerOver, onPointerOut } = useTableCellTooltip({
          enabled: () => false,
          headerEnabled: () => true,
          delay: () => 0,
          tipRef,
        })
        return { state, onPointerOver, onPointerOut, tipRef }
      },
      template: `
        <div @pointerover="onPointerOver" @pointerout="onPointerOut">
          <span class="rs-table__th-label" data-rs-table-header-tip="字段: id&#10;类型: int">id</span>
          <div
            v-if="state.visible"
            ref="tipRef"
            class="rs-table__shared-tip"
            :class="{ 'rs-table__shared-tip--header': state.kind === 'header' }"
            :style="state.style"
          >{{ state.text }}</div>
        </div>
      `,
    })
    const wrapper = mount(HeaderHost, { attachTo: document.body })
    await wrapper.find('.rs-table__th-label').trigger('pointerover', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('.rs-table__shared-tip--header').exists()).toBe(true)
    expect(wrapper.find('.rs-table__shared-tip').text()).toContain('字段: id')
    wrapper.unmount()
  })
})
