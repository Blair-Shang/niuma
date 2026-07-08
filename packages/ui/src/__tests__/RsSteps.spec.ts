import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsSteps from '../components/RsSteps.vue'
import { isStepSeparatorCompleted, resolveStepStatus } from '../components/steps-utils'

const items = [
  { value: 'a', title: '步骤 A', description: '描述 A' },
  { value: 'b', title: '步骤 B' },
  { value: 'c', title: '步骤 C' },
]

describe('steps-utils', () => {
  it('resolveStepStatus derives finish/process/wait from active index', () => {
    expect(resolveStepStatus(0, 1)).toBe('finish')
    expect(resolveStepStatus(1, 1)).toBe('process')
    expect(resolveStepStatus(2, 1)).toBe('wait')
  })

  it('resolveStepStatus prefers explicit status', () => {
    expect(resolveStepStatus(1, 0, 'error')).toBe('error')
  })

  it('isStepSeparatorCompleted is true only for finish', () => {
    expect(isStepSeparatorCompleted('finish')).toBe(true)
    expect(isStepSeparatorCompleted('process')).toBe(false)
  })
})

describe('RsSteps', () => {
  it('renders all step titles and descriptions', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'b' },
    })
    expect(wrapper.text()).toContain('步骤 A')
    expect(wrapper.text()).toContain('描述 A')
    expect(wrapper.text()).toContain('步骤 B')
    expect(wrapper.text()).toContain('步骤 C')
  })

  it('applies auto-derived status classes', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'b' },
    })
    const stepItems = wrapper.findAll('.rs-steps__item')
    expect(stepItems[0]?.classes()).toContain('rs-steps__item--finish')
    expect(stepItems[1]?.classes()).toContain('rs-steps__item--process')
    expect(stepItems[2]?.classes()).toContain('rs-steps__item--wait')
  })

  it('applies explicit status when provided', () => {
    const wrapper = mount(RsSteps, {
      props: {
        items: [
          { value: 'a', title: 'A', status: 'finish' as const },
          { value: 'b', title: 'B', status: 'error' as const },
        ],
        modelValue: 'a',
      },
    })
    const stepItems = wrapper.findAll('.rs-steps__item')
    expect(stepItems[1]?.classes()).toContain('rs-steps__item--error')
  })

  it('renders horizontal layout and md size by default', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'a' },
    })
    expect(wrapper.find('.rs-steps').classes()).toContain('rs-steps--horizontal')
    expect(wrapper.find('.rs-steps').classes()).toContain('rs-steps--md')
  })

  it('renders vertical and sm modifiers', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'a', orientation: 'vertical', size: 'sm' },
    })
    expect(wrapper.find('.rs-steps').classes()).toContain('rs-steps--vertical')
    expect(wrapper.find('.rs-steps').classes()).toContain('rs-steps--sm')
  })

  it('renders separators between items but not after the last', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'a' },
    })
    expect(wrapper.findAll('.rs-steps__separator')).toHaveLength(items.length - 1)
  })

  it('disables triggers when not clickable', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'a' },
    })
    wrapper.findAll('.rs-steps__trigger').forEach((trigger) => {
      expect((trigger.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('updates model when a clickable step is selected', async () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'a', clickable: true },
    })
    await wrapper.findAll('.rs-steps__trigger')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('does not update model when disabled step is clicked', async () => {
    const wrapper = mount(RsSteps, {
      props: {
        items: [
          { value: 'a', title: 'A' },
          { value: 'b', title: 'B', disabled: true },
        ],
        modelValue: 'a',
        clickable: true,
      },
    })
    await wrapper.findAll('.rs-steps__trigger')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('falls back to first step when model value is unknown', () => {
    const wrapper = mount(RsSteps, {
      props: { items, modelValue: 'missing' },
    })
    expect(wrapper.findAll('.rs-steps__item')[0]?.classes()).toContain('rs-steps__item--process')
  })
})
