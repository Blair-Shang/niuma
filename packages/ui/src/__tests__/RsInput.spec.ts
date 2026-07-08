import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsInput from '../components/RsInput.vue'
import {
  runInputValidation,
  validateInputRule,
} from '../components/input-rules'

describe('input-rules', () => {
  it('validates email rule', () => {
    expect(validateInputRule('a@b.com', 'email')).toBe(true)
    expect(validateInputRule('bad', 'email')).toBe(false)
    expect(validateInputRule('', 'email')).toBe(true)
  })

  it('validates number and integer', () => {
    expect(validateInputRule('12.5', 'number')).toBe(true)
    expect(validateInputRule('12a', 'number')).toBe(false)
    expect(validateInputRule('42', 'integer')).toBe(true)
    expect(validateInputRule('3.14', 'integer')).toBe(false)
  })

  it('validates required in runInputValidation', () => {
    expect(runInputValidation('', { required: true }).valid).toBe(false)
    expect(runInputValidation('x', { required: true }).valid).toBe(true)
  })
})

describe('RsInput', () => {
  it('emits update:modelValue on input', async () => {
    const wrapper = mount(RsInput, { props: { modelValue: '' } })
    await wrapper.find('input').setValue('world')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['world'])
  })

  it('marks invalid state on group', () => {
    const wrapper = mount(RsInput, { props: { invalid: true } })
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--invalid')
  })

  it('applies size class on group', () => {
    const wrapper = mount(RsInput, { props: { size: 'lg' } })
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--lg')
  })

  it('defaults to md size', () => {
    const wrapper = mount(RsInput)
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--md')
  })

  it('binds id and type attributes', () => {
    const wrapper = mount(RsInput, {
      props: { id: 'email', type: 'email' },
    })
    const input = wrapper.find('input')
    expect(input.attributes('id')).toBe('email')
    expect(input.attributes('type')).toBe('email')
  })

  it('auto-generates id when not provided', () => {
    const wrapper = mount(RsInput)
    const input = wrapper.find('input')
    expect(input.attributes('id')).toBeTruthy()
  })

  it('renders label, hint, and required marker', () => {
    const wrapper = mount(RsInput, {
      props: {
        label: '邮箱',
        hint: '用于登录与通知',
        required: true,
      },
    })
    expect(wrapper.classes()).toContain('rs-field')
    expect(wrapper.find('.rs-field__label').text()).toContain('邮箱')
    expect(wrapper.find('.rs-field__required').exists()).toBe(true)
    expect(wrapper.find('.rs-field__hint').text()).toBe('用于登录与通知')
  })

  it('associates label with input via for/id', () => {
    const wrapper = mount(RsInput, {
      props: { label: '名称', id: 'name-field' },
    })
    expect(wrapper.find('label').attributes('for')).toBe('name-field')
    expect(wrapper.find('input').attributes('id')).toBe('name-field')
  })

  it('associates left label with input via for/id', () => {
    const wrapper = mount(RsInput, {
      props: { label: '名称', labelPosition: 'left', id: 'name-field' },
    })
    expect(wrapper.classes()).toContain('rs-field--label-left')
    expect(wrapper.find('label').attributes('for')).toBe('name-field')
    expect(wrapper.find('input').attributes('id')).toBe('name-field')
  })

  it('keeps left label aligned when validation error appears', async () => {
    const wrapper = mount(RsInput, {
      props: {
        label: '邮箱',
        labelPosition: 'left',
        modelValue: '',
        required: true,
      },
    })
    await wrapper.find('input').trigger('blur')
    const error = wrapper.find('.rs-input-field__error')
    expect(error.exists()).toBe(true)
    expect(error.element.parentElement?.classList.contains('rs-input-field')).toBe(false)
  })

  it('sets placeholder', () => {
    const wrapper = mount(RsInput, {
      props: { placeholder: '请输入邮箱' },
    })
    expect(wrapper.find('input').attributes('placeholder')).toBe('请输入邮箱')
  })

  it('disables input when disabled', () => {
    const wrapper = mount(RsInput, { props: { disabled: true } })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })

  it('reflects external modelValue', () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: '初始值' },
    })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('初始值')
  })

  it('renders prefix and suffix props', () => {
    const wrapper = mount(RsInput, {
      props: { prefix: '￥', suffix: '元' },
    })
    expect(wrapper.text()).toContain('￥')
    expect(wrapper.text()).toContain('元')
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--has-prefix')
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--has-suffix')
  })

  it('renders prefix slot', () => {
    const wrapper = mount(RsInput, {
      slots: {
        prefix: () => h('span', { class: 'custom-prefix' }, '@'),
      },
    })
    expect(wrapper.find('.custom-prefix').exists()).toBe(true)
  })

  it('validates email on blur', async () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'bad-email', rule: 'email', id: 'e1' },
    })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--invalid')
    expect(wrapper.find('.rs-input-field__error').text()).toContain('邮箱')
    expect(wrapper.emitted('validate')?.[0]?.[0]).toEqual({
      valid: false,
      message: '请输入有效的邮箱地址',
    })
  })

  it('passes email validation on blur', async () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'user@example.com', rule: 'email' },
    })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.find('.rs-input-group').classes()).not.toContain('rs-input-group--invalid')
    expect(wrapper.emitted('validate')?.[0]?.[0]).toEqual({ valid: true })
  })

  it('uses custom validator', async () => {
    const wrapper = mount(RsInput, {
      props: {
        modelValue: 'ab',
        validator: (v: string) => v.length >= 3 || '至少 3 个字符',
      },
    })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.find('.rs-input-field__error').text()).toBe('至少 3 个字符')
  })

  it('validates email on blur with en-US locale', async () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsInput, {
            modelValue: 'bad-email',
            rule: 'email',
            id: 'e2',
            'onUpdate:modelValue': () => {},
          }),
      },
    })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.find('.rs-input-field__error').text()).toContain('email')
  })

  it('clears value when clearable button is clicked', async () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'hello', clearable: true },
    })
    await wrapper.find('.rs-input-group__action').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('shows character count when showCount and maxlength are set', () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'abc', maxlength: 10, showCount: true },
    })
    expect(wrapper.find('.rs-input-group__count').text()).toBe('3 / 10')
    expect(wrapper.find('input').attributes('maxlength')).toBe('10')
  })

  it('sets readonly on input and group class', () => {
    const wrapper = mount(RsInput, { props: { readonly: true, modelValue: 'x' } })
    expect(wrapper.find('input').attributes('readonly')).toBeDefined()
    expect(wrapper.find('.rs-input-group').classes()).toContain('rs-input-group--readonly')
  })

  it('toggles password visibility', async () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'secret', type: 'password' as const },
    })
    expect(wrapper.find('input').attributes('type')).toBe('password')
    expect(wrapper.find('.rs-input-group--has-suffix').exists()).toBe(true)
    const toggle = wrapper.find('button.rs-input-group__action')
    expect(toggle.exists()).toBe(true)
    await toggle.trigger('click')
    expect(wrapper.find('input').attributes('type')).toBe('text')
  })

  it('hides password toggle when visibilityToggle is false', () => {
    const wrapper = mount(RsInput, {
      props: { modelValue: 'secret', type: 'password', visibilityToggle: false },
    })
    expect(wrapper.find('button.rs-input-group__action').exists()).toBe(false)
  })

  it('emits pressEnter on Enter key', async () => {
    const wrapper = mount(RsInput, { props: { modelValue: '' } })
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('pressEnter')).toHaveLength(1)
  })
})
