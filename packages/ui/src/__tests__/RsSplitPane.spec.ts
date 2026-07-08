import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsSplitPane from '../components/RsSplitPane.vue'
import type { RsSplitPaneItem } from '../components/split-pane-utils'

const twoPanes: RsSplitPaneItem[] = [{ key: 'a' }, { key: 'b' }]

function mountSplit(props: Record<string, unknown> = {}) {
  return mount(RsSplitPane, {
    props: { panes: twoPanes, ...props },
    slots: {
      a: '<div class="pane-a">A</div>',
      b: '<div class="pane-b">B</div>',
    },
  })
}

describe('RsSplitPane', () => {
  it('renders one pane per item plus n-1 resizers', () => {
    const wrapper = mountSplit()
    expect(wrapper.findAll('.rs-split__pane')).toHaveLength(2)
    expect(wrapper.findAll('.rs-split__resizer')).toHaveLength(1)
    expect(wrapper.find('.pane-a').text()).toBe('A')
    expect(wrapper.find('.pane-b').text()).toBe('B')
  })

  it('defaults to an equal split and reflects it on the separator', () => {
    const wrapper = mountSplit()
    const resizer = wrapper.find('.rs-split__resizer')
    expect(resizer.element.tagName).toBe('HR')
    expect(resizer.attributes('aria-valuenow')).toBe('50')
    expect(resizer.attributes('aria-orientation')).toBe('vertical')
  })

  it('applies the orientation modifier class', () => {
    expect(mountSplit().classes()).toContain('rs-split--horizontal')
    expect(mountSplit({ orientation: 'vertical' }).classes()).toContain('rs-split--vertical')
  })

  it('resizes with the keyboard along the active axis', async () => {
    const wrapper = mountSplit({ keyboardStep: 4 })
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:sizes')?.pop()).toEqual([[54, 46]])
    expect(wrapper.emitted('resize-end')).toBeTruthy()
  })

  it('ignores cross-axis arrow keys', async () => {
    const wrapper = mountSplit({ orientation: 'horizontal' })
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:sizes')).toBeFalsy()
  })

  it('jumps to bounds with Home / End', async () => {
    const wrapper = mountSplit()
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:sizes')?.pop()).toEqual([[100, 0]])
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:sizes')?.pop()).toEqual([[0, 100]])
  })

  it('does not resize when disabled and removes the separator from tab order', async () => {
    const wrapper = mountSplit({ disabled: true })
    const resizer = wrapper.find('.rs-split__resizer')
    expect(resizer.attributes('tabindex')).toBe('-1')
    expect(wrapper.classes()).toContain('rs-split--disabled')
    await resizer.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:sizes')).toBeFalsy()
  })

  it('renders the grip only when withHandle is set', () => {
    expect(mountSplit().find('.rs-split__grip').exists()).toBe(false)
    expect(mountSplit({ withHandle: true }).find('.rs-split__grip').exists()).toBe(true)
  })

  it('honours controlled v-model sizes', () => {
    const wrapper = mountSplit({ sizes: [70, 30] })
    expect(wrapper.find('.rs-split__resizer').attributes('aria-valuenow')).toBe('70')
  })

  it('reacts to external size updates', async () => {
    const wrapper = mountSplit({ sizes: [50, 50] })
    await wrapper.setProps({ sizes: [20, 80] })
    expect(wrapper.find('.rs-split__resizer').attributes('aria-valuenow')).toBe('20')
  })

  it('exposes collapse / expand / reset controls', async () => {
    const wrapper = mount(RsSplitPane, {
      props: {
        panes: [
          { key: 'a', size: 40, min: 20, collapsible: true, collapsedSize: 0 },
          { key: 'b', size: 60 },
        ] satisfies RsSplitPaneItem[],
      },
      slots: { a: 'A', b: 'B' },
    })
    const vm = wrapper.vm as unknown as {
      collapse: (key: string) => void
      expand: (key: string, size?: number) => void
      reset: () => void
      getSizes: () => number[]
    }

    vm.collapse('a')
    await wrapper.vm.$nextTick()
    expect(vm.getSizes()).toEqual([0, 100])
    expect(wrapper.emitted('collapse')?.pop()).toEqual(['a'])

    vm.expand('a', 30)
    await wrapper.vm.$nextTick()
    expect(vm.getSizes()).toEqual([30, 70])
    expect(wrapper.emitted('expand')?.pop()).toEqual(['a'])

    vm.reset()
    await wrapper.vm.$nextTick()
    expect(vm.getSizes()).toEqual([40, 60])
  })

  it('toggles collapse via keyboard on the separator', async () => {
    const wrapper = mount(RsSplitPane, {
      props: {
        panes: [
          { key: 'a', size: 40, min: 20, collapsible: true, collapsedSize: 0 },
          { key: 'b', size: 60 },
        ] satisfies RsSplitPaneItem[],
      },
      slots: { a: 'A', b: 'B' },
    })
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('collapse')?.pop()).toEqual(['a'])
    await wrapper.find('.rs-split__resizer').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('expand')?.pop()).toEqual(['a'])
  })

  it('does not mutate nested split panes when resizing the outer separator', async () => {
    const outer = mount(RsSplitPane, {
      props: {
        orientation: 'vertical',
        panes: [{ key: 'top', size: 70 }, { key: 'bottom', size: 30 }],
        sizes: [70, 30],
        keyboardStep: 10,
      },
      slots: {
        top: {
          template: `
            <RsSplitPane
              :panes="[{ key: 'left' }, { key: 'right' }]"
              :sizes="[40, 60]"
            >
              <template #left><div class="inner-left">L</div></template>
              <template #right><div class="inner-right">R</div></template>
            </RsSplitPane>
          `,
          components: { RsSplitPane },
        },
        bottom: '<div class="bottom-pane">B</div>',
      },
    })

    const resizers = outer.findAll('.rs-split__resizer')
    expect(resizers).toHaveLength(2)
    expect(resizers[0]!.attributes('aria-valuenow')).toBe('40')
    expect(resizers[1]!.attributes('aria-valuenow')).toBe('70')

    await resizers[1]!.trigger('keydown', { key: 'ArrowDown' })

    expect(resizers[0]!.attributes('aria-valuenow')).toBe('40')
    expect(outer.emitted('update:sizes')?.pop()).toEqual([[80, 20]])
  })
})
