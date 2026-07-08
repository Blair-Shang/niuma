import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import RsTabs from '../components/RsTabs.vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import { getNextTabAfterClose, isTabClosable, isTabRenamable, reorderTabItems, resolveVisibleTabValues } from '../components/tabs-utils'

const items = [
  { value: 'a', label: '标签 A' },
  { value: 'b', label: '标签 B', icon: 'settings' as const },
  { value: 'c', label: '标签 C', badge: 9 },
]

function mountTabs(
  props: Record<string, unknown> = {},
  slots?: Record<string, () => ReturnType<typeof h>>,
) {
  return mount(RsTabs, {
    props: {
      items,
      modelValue: 'a',
      ...props,
    },
    slots: {
      a: () => h('p', { class: 'panel-a' }, '内容 A'),
      b: () => h('p', { class: 'panel-b' }, '内容 B'),
      c: () => h('p', { class: 'panel-c' }, '内容 C'),
      ...slots,
    },
  })
}

describe('tabs-utils', () => {
  it('isTabClosable respects per-item override and global default', () => {
    expect(isTabClosable({ value: 'a', label: 'A' }, true)).toBe(true)
    expect(isTabClosable({ value: 'a', label: 'A', closable: false }, true)).toBe(false)
    expect(isTabClosable({ value: 'a', label: 'A', closable: true }, false)).toBe(true)
  })

  it('getNextTabAfterClose prefers right neighbor then left', () => {
    const items = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ]
    expect(getNextTabAfterClose(items, 'b', 'b')).toBe('c')
    expect(getNextTabAfterClose(items, 'c', 'c')).toBe('b')
    expect(getNextTabAfterClose(items, 'a', 'b')).toBe('b')
  })

  it('reorderTabItems moves drag item before drop target', () => {
    const items = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ]
    const next = reorderTabItems(items, 'c', 'a')
    expect(next.map((item) => item.value)).toEqual(['c', 'a', 'b'])
  })

  it('isTabRenamable respects per-item override', () => {
    expect(isTabRenamable({ value: 'a', label: 'A' }, true)).toBe(true)
    expect(isTabRenamable({ value: 'a', label: 'A', renamable: false }, true)).toBe(false)
  })

  it('resolveVisibleTabValues keeps active tab visible when keepActiveVisible is true', () => {
    const items = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ]
    const widths = new Map([
      ['a', 80],
      ['b', 80],
      ['c', 80],
    ])
    const visible = resolveVisibleTabValues(items, widths, 100, 'c', 0, {
      keepActiveVisible: true,
    })
    expect(visible.has('c')).toBe(true)
  })

  it('resolveVisibleTabValues hides active tab from bar in dropdown mode', () => {
    const items = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ]
    const widths = new Map([
      ['a', 80],
      ['b', 80],
      ['c', 80],
    ])
    const visible = resolveVisibleTabValues(items, widths, 100, 'c', 0, {
      keepActiveVisible: false,
    })
    expect(visible.has('c')).toBe(false)
    expect(visible.has('a')).toBe(true)
  })
})

describe('RsTabs', () => {
  it('renders root with tabs aria-label', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.rs-tabs').attributes('aria-label')).toBe('标签页')
  })

  it('uses en-US aria-label when locale is en-US', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsTabs, {
            items,
            modelValue: 'a',
          }),
      },
    })
    expect(wrapper.find('.rs-tabs').attributes('aria-label')).toBe('Tabs')
  })

  it('renders all tab labels', () => {
    const wrapper = mountTabs()
    expect(wrapper.text()).toContain('标签 A')
    expect(wrapper.text()).toContain('标签 B')
    expect(wrapper.text()).toContain('标签 C')
  })

  it('renders icon and badge', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.rs-icon').exists()).toBe(true)
    expect(wrapper.find('.rs-tabs__badge').text()).toBe('9')
  })

  it('marks active trigger with data-state active', () => {
    const wrapper = mountTabs({ modelValue: 'b' })
    const triggers = wrapper.findAll('.rs-tabs__trigger')
    expect(triggers[0]?.attributes('data-state')).toBe('inactive')
    expect(triggers[1]?.attributes('data-state')).toBe('active')
  })

  it('emits update:modelValue when another tab is clicked', async () => {
    const wrapper = mountTabs()
    await wrapper.findAll('.rs-tabs__trigger')[1]?.trigger('mousedown', { button: 0 })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.pop()).toEqual(['b'])
  })

  it('does not emit update:modelValue when disabled tab is clicked', async () => {
    const wrapper = mount(RsTabs, {
      props: {
        items: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
        ],
        modelValue: 'a',
      },
      slots: {
        a: () => h('p', 'A'),
        b: () => h('p', 'B'),
      },
    })
    await wrapper.findAll('.rs-tabs__trigger')[1]?.trigger('mousedown', { button: 0 })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('shows active panel content', () => {
    const wrapper = mountTabs({ modelValue: 'a' })
    expect(wrapper.find('.panel-a').exists()).toBe(true)
    expect(wrapper.find('.panel-b').exists()).toBe(false)
  })

  it('hides panels when panelless is true', () => {
    const wrapper = mountTabs({ panelless: true })
    expect(wrapper.find('.rs-tabs__panel').exists()).toBe(false)
    expect(wrapper.find('.panel-a').exists()).toBe(false)
  })

  it('wraps list and panels in a shared body container', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.rs-tabs__body').exists()).toBe(true)
    expect(wrapper.find('.rs-tabs__panel-inner').exists()).toBe(true)
  })

  it('uses line variant by default', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--line')
  })

  it('applies segmented variant class', () => {
    const wrapper = mountTabs({ variant: 'segmented' })
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--segmented')
  })

  it('applies sm size class on root', () => {
    const wrapper = mountTabs({ size: 'sm' })
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--sm')
  })

  it('applies md size class by default', () => {
    const wrapper = mountTabs()
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--md')
  })

  it('renders close buttons when closable is true', () => {
    const wrapper = mountTabs({ closable: true })
    expect(wrapper.findAll('.rs-tabs__close')).toHaveLength(items.length)
  })

  it('hides close button when item sets closable false', () => {
    const wrapper = mount(RsTabs, {
      props: {
        items: [
          { value: 'a', label: 'A', closable: false },
          { value: 'b', label: 'B' },
        ],
        modelValue: 'a',
        closable: true,
      },
      slots: {
        a: () => h('p', 'A'),
        b: () => h('p', 'B'),
      },
    })
    expect(wrapper.findAll('.rs-tabs__close')).toHaveLength(1)
  })

  it('emits close and switches active tab when closing current tab', async () => {
    const wrapper = mountTabs({ modelValue: 'b', closable: true })
    await wrapper.findAll('.rs-tabs__close')[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('close')?.[0]).toEqual(['b'])
    expect(wrapper.emitted('update:modelValue')?.pop()).toEqual(['c'])
  })

  it('does not emit close when item is disabled', async () => {
    const wrapper = mount(RsTabs, {
      props: {
        items: [{ value: 'a', label: 'A', disabled: true }],
        modelValue: 'a',
        closable: true,
      },
      slots: { a: () => h('p', 'A') },
    })
    await wrapper.find('.rs-tabs__close').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('renders add button and emits add when addable', async () => {
    const wrapper = mountTabs({ addable: true })
    expect(wrapper.find('.rs-tabs__add').exists()).toBe(true)
    await wrapper.find('.rs-tabs__add').trigger('click')
    expect(wrapper.emitted('add')?.length).toBe(1)
  })

  it('hides add button when maxCount is reached', () => {
    const wrapper = mountTabs({ addable: true, maxCount: items.length })
    expect(wrapper.find('.rs-tabs__add').exists()).toBe(false)
  })

  it('uses en-US labels for close and add buttons', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsTabs, {
            items: [{ value: 'a', label: 'Docs' }],
            modelValue: 'a',
            closable: true,
            addable: true,
          }, {
            a: () => h('p', 'A'),
          }),
      },
    })
    expect(wrapper.find('.rs-tabs__close').attributes('aria-label')).toBe('Close Docs')
    expect(wrapper.find('.rs-tabs__add').attributes('aria-label')).toBe('Add tab')
  })

  it('applies card variant class', () => {
    const wrapper = mountTabs({ variant: 'card' })
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--card')
  })

  it('renders drag handle when draggable', () => {
    const wrapper = mountTabs({ draggable: true })
    expect(wrapper.find('.rs-tabs__drag-handle').exists()).toBe(true)
  })

  it('emits reorder on drop', async () => {
    const wrapper = mountTabs({ draggable: true })
    const triggers = wrapper.findAll('.rs-tabs__trigger')
    await wrapper.findAll('.rs-tabs__drag-handle')[0]?.trigger('dragstart', {
      dataTransfer: { setData: () => {}, effectAllowed: 'move' },
    })
    await triggers[2]?.trigger('drop', { preventDefault: () => {} })
    expect(wrapper.emitted('reorder')?.[0]).toEqual(['a', 'c'])
  })

  it('enters rename mode on label double click when renamable', async () => {
    const wrapper = mountTabs({ renamable: true })
    await wrapper.find('.rs-tabs__label').trigger('dblclick')
    await flushPromises()
    expect(wrapper.find('.rs-tabs__rename-input').exists()).toBe(true)
  })

  it('emits rename on input blur', async () => {
    const wrapper = mountTabs({ renamable: true })
    await wrapper.find('.rs-tabs__label').trigger('dblclick')
    await flushPromises()
    const input = wrapper.find('.rs-tabs__rename-input')
    await input.setValue('新标签 A')
    await input.trigger('blur')
    await flushPromises()
    expect(wrapper.emitted('rename')?.[0]).toEqual(['a', '新标签 A'])
  })

  it('applies scrollable class when overflow is scroll', () => {
    const wrapper = mountTabs({ overflow: 'scroll' })
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--scrollable')
  })

  it('applies dropdown overflow class when overflow is dropdown', () => {
    const wrapper = mountTabs({ overflow: 'dropdown' })
    expect(wrapper.find('.rs-tabs').classes()).toContain('rs-tabs--dropdown-overflow')
  })
})
