import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RsCalendarGrid from '../components/RsCalendarGrid.vue'

describe('RsCalendarGrid', () => {
  it('renders month navigation and a 7×6 date grid', () => {
    const wrapper = mount(RsCalendarGrid, {
      props: { viewYear: 2025, viewMonth: 6 },
    })
    expect(wrapper.find('.rs-calendar-grid__table').exists()).toBe(true)
    expect(wrapper.findAll('thead th')).toHaveLength(7)
    expect(wrapper.findAll('.rs-calendar-grid__cell')).toHaveLength(42)
    expect(wrapper.find('.rs-calendar-grid__title').text()).toContain('2025')
  })

  it('emits select when a cell is clicked', async () => {
    const wrapper = mount(RsCalendarGrid, {
      props: { viewYear: 2025, viewMonth: 6 },
    })
    const enabled = wrapper
      .findAll('.rs-calendar-grid__cell')
      .find((btn) => !btn.attributes('disabled'))
    await enabled?.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({
      year: expect.any(Number),
      month: expect.any(Number),
      day: expect.any(Number),
    })
  })

  it('marks the selected date with selected class', () => {
    const wrapper = mount(RsCalendarGrid, {
      props: {
        viewYear: 2025,
        viewMonth: 6,
        selected: { year: 2025, month: 6, day: 16 },
      },
    })
    expect(wrapper.find('.rs-calendar-grid__cell--selected').exists()).toBe(true)
  })

  it('shows outside-month cells', () => {
    const wrapper = mount(RsCalendarGrid, {
      props: { viewYear: 2025, viewMonth: 6 },
    })
    expect(wrapper.findAll('.rs-calendar-grid__cell--outside').length).toBeGreaterThan(0)
  })

  it('disables dates listed in disabledDates', () => {
    const wrapper = mount(RsCalendarGrid, {
      props: {
        viewYear: 2025,
        viewMonth: 6,
        disabledDates: ['2025-06-01', '2025-06-15', '2025-06-30'],
      },
    })
    const disabledCount = wrapper
      .findAll('.rs-calendar-grid__cell')
      .filter((btn) => btn.attributes('disabled') !== undefined).length
    expect(disabledCount).toBeGreaterThanOrEqual(3)
  })

  it('updates view month via navigation', async () => {
    const wrapper = mount(RsCalendarGrid, {
      props: { viewYear: 2025, viewMonth: 6 },
    })
    await wrapper.findAll('.rs-calendar-grid__nav')[1].trigger('click')
    expect(wrapper.emitted('update:viewMonth')?.[0]).toEqual([7])
  })

  it('highlights range between start and end', () => {
    const wrapper = mount(RsCalendarGrid, {
      props: {
        viewYear: 2025,
        viewMonth: 6,
        rangeStart: { year: 2025, month: 6, day: 10 },
        rangeEnd: { year: 2025, month: 6, day: 12 },
      },
    })
    expect(wrapper.findAll('.rs-calendar-grid__cell--in-range').length).toBeGreaterThan(0)
  })
})
