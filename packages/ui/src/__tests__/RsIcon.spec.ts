import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsIcon from '../components/RsIcon.vue'
import {
  isRsIconName,
  lucideIconCount,
  resolveLucideIcon,
  rsCommonIconNames,
} from '../icons/registry'

describe('RsIcon', () => {
  it('loads lucide icon module', () => {
    const icon = resolveLucideIcon('house')
    expect(icon).toBeTruthy()
  })

  it('loads custom ftp icon', () => {
    const icon = resolveLucideIcon('ftp')
    expect(icon).toBeTruthy()
    const wrapper = mount(RsIcon, { props: { name: 'ftp' } })
    expect(wrapper.find('svg.rs-icon').exists()).toBe(true)
    expect(wrapper.find('.ftp-icon__folder').exists()).toBe(true)
    expect(wrapper.find('.ftp-icon__label').exists()).toBe(true)
    expect(wrapper.find('.ftp-icon__label').text()).toBe('FTP')
    expect(isRsIconName('ftp')).toBe(true)
  })

  it('loads arbitrary lucide icon by name', () => {
    const icon = resolveLucideIcon('trash-2')
    expect(icon).toBeTruthy()
  })

  it('renders svg for known icon', () => {
    const wrapper = mount(RsIcon, { props: { name: 'house' } })
    expect(wrapper.find('svg.rs-icon').exists()).toBe(true)
    expect(wrapper.find('path').exists()).toBe(true)
  })

  it('renders lucide icon by kebab-case name', () => {
    const wrapper = mount(RsIcon, { props: { name: 'trash-2' } })
    expect(wrapper.find('svg.rs-icon').exists()).toBe(true)
  })

  it('renders all common icons', () => {
    for (const name of rsCommonIconNames) {
      const wrapper = mount(RsIcon, { props: { name } })
      expect(wrapper.find('svg.rs-icon').exists(), `icon failed: ${name}`).toBe(true)
    }
  })

  it('exposes lucide library size', () => {
    expect(lucideIconCount).toBeGreaterThan(100)
    expect(isRsIconName('trash-2')).toBe(true)
    expect(isRsIconName('not-a-real-icon')).toBe(false)
  })

  it('renders multiple paths for complex icons', () => {
    const wrapper = mount(RsIcon, { props: { name: 'loader' } })
    expect(wrapper.findAll('path').length).toBeGreaterThan(1)
  })

  it('renders nothing for unknown icon', () => {
    const wrapper = mount(RsIcon, { props: { name: 'not-a-real-icon' } })
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('applies numeric size', () => {
    const wrapper = mount(RsIcon, { props: { name: 'house', size: 24 } })
    expect(wrapper.find('svg').attributes('width')).toBe('24')
    expect(wrapper.find('svg').attributes('height')).toBe('24')
  })

  it.each(['sm', 'md', 'lg'] as const)('applies %s size preset', (size) => {
    const wrapper = mount(RsIcon, { props: { name: 'house', size } })
    const expected = { sm: '14', md: '16', lg: '20' }[size]
    expect(wrapper.find('svg').attributes('width')).toBe(expected)
  })

  it('applies css length size', () => {
    const wrapper = mount(RsIcon, { props: { name: 'house', size: '1.5rem' } })
    expect(wrapper.find('svg').attributes('style')).toContain('width: 1.5rem')
  })

  it('applies custom stroke width', () => {
    const wrapper = mount(RsIcon, { props: { name: 'search', strokeWidth: 2.5 } })
    expect(wrapper.find('svg').attributes('stroke-width')).toBe('2.5')
  })

  it('applies color style', () => {
    const wrapper = mount(RsIcon, { props: { name: 'check', color: 'var(--rs-success)' } })
    expect(wrapper.find('svg').attributes('style')).toContain('color: var(--rs-success)')
  })

  it('applies accent color to custom ftp icon', () => {
    const wrapper = mount(RsIcon, { props: { name: 'ftp', color: '#34C759' } })
    expect(wrapper.find('svg').attributes('style')).toContain('--rs-icon-ftp-accent: #34C759')
  })

  it('applies rotate transform', () => {
    const wrapper = mount(RsIcon, { props: { name: 'chevron-right', rotate: 90 } })
    expect(wrapper.find('svg').attributes('style')).toContain('rotate(90deg)')
  })

  it('applies horizontal flip', () => {
    const wrapper = mount(RsIcon, { props: { name: 'chevron-right', flip: 'horizontal' } })
    expect(wrapper.find('svg').attributes('style')).toContain('scaleX(-1)')
  })

  it('applies spin class', () => {
    const wrapper = mount(RsIcon, { props: { name: 'loader', spin: true } })
    expect(wrapper.find('svg').classes()).toContain('rs-icon--spin')
  })

  it('sets semantic attributes when label is provided', () => {
    const wrapper = mount(RsIcon, { props: { name: 'settings', label: '设置' } })
    expect(wrapper.find('svg').attributes('aria-label')).toBe('设置')
    expect(wrapper.find('svg').attributes('role')).toBe('img')
    expect(wrapper.find('svg').attributes('aria-hidden')).toBeUndefined()
  })

  it('hides decorative icon from assistive tech', () => {
    const wrapper = mount(RsIcon, { props: { name: 'plus' } })
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg').attributes('role')).toBeUndefined()
  })

  it('merges external class onto svg', () => {
    const wrapper = mount(RsIcon, {
      props: { name: 'house' },
      attrs: { class: 'custom-icon' },
    })
    expect(wrapper.find('svg').classes()).toContain('rs-icon')
    expect(wrapper.find('svg').classes()).toContain('custom-icon')
  })
})
