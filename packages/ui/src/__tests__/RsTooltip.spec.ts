import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsTooltip from '../components/RsTooltip.vue'
import RsTooltipProvider from '../components/RsTooltipProvider.vue'

function mountTooltip(
  template: string,
  props: Record<string, unknown> = {},
) {
  return mount(
    {
      components: { RsTooltip, RsTooltipProvider },
      template: `<RsTooltipProvider :delay-duration="0"><RsTooltip v-bind="props">${template}</RsTooltip></RsTooltipProvider>`,
      data() {
        return { props }
      },
    },
    { attachTo: document.body },
  )
}

describe('RsTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows content on pointer enter', async () => {
    const wrapper = mountTooltip(
      '<button type="button" class="trigger">Hover</button>',
      { content: 'Tooltip text' },
    )
    expect(document.body.querySelector('.rs-tooltip__content')).toBeNull()
    await wrapper.find('.trigger').trigger('pointermove', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(document.body.querySelector('.rs-tooltip__content')).not.toBeNull()
    expect(document.body.textContent).toContain('Tooltip text')
    wrapper.unmount()
  })

  it('does not show when disabled', async () => {
    const wrapper = mountTooltip(
      '<button type="button" class="trigger">Hover</button>',
      { content: 'Hidden', disabled: true },
    )
    await wrapper.find('.trigger').trigger('pointermove', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(document.body.querySelector('.rs-tooltip__content')).toBeNull()
    wrapper.unmount()
  })

  it('renders custom content slot', async () => {
    const wrapper = mount(
      {
        components: { RsTooltip, RsTooltipProvider },
        template: `
          <RsTooltipProvider :delay-duration="0">
            <RsTooltip>
              <button type="button" class="trigger">Hover</button>
              <template #content>
                <span class="custom-tip">Custom body</span>
              </template>
            </RsTooltip>
          </RsTooltipProvider>
        `,
      },
      { attachTo: document.body },
    )
    await wrapper.find('.trigger').trigger('pointermove', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(document.body.querySelector('.custom-tip')).not.toBeNull()
    wrapper.unmount()
  })

  it('unmounts without leaving tooltip content in body', async () => {
    const wrapper = mountTooltip(
      '<button type="button" class="trigger">Hover</button>',
      { content: 'Cleanup' },
    )
    await wrapper.find('.trigger').trigger('pointermove', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    wrapper.unmount()
    expect(document.body.querySelector('.rs-tooltip__content')).toBeNull()
  })

  it('renders suffix help icon when icon=true', async () => {
    const wrapper = mountTooltip('<span class="field-label">Database</span>', {
      content: 'Initial database hint',
      icon: true,
    })
    expect(wrapper.find('.rs-tooltip__with-icon').exists()).toBe(true)
    expect(wrapper.find('.field-label').exists()).toBe(true)
    const trigger = wrapper.find('.rs-tooltip__icon-trigger')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-label')).toBe('Initial database hint')
    expect(document.body.querySelector('.rs-tooltip__content')).toBeNull()
    await trigger.trigger('pointermove', { pointerType: 'mouse' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(document.body.querySelector('.rs-tooltip__content')).not.toBeNull()
    expect(document.body.textContent).toContain('Initial database hint')
    wrapper.unmount()
  })
})
