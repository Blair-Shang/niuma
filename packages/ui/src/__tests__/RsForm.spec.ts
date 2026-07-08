import { defineComponent, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsForm from '../components/RsForm.vue'
import RsInput from '../components/RsInput.vue'
import RsSelect from '../components/RsSelect.vue'

const roleOptions = [
  { label: '成员', value: 'member' },
  { label: '管理员', value: 'admin' },
]

describe('RsForm', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders form element with base class', () => {
    const wrapper = mount(RsForm, {
      slots: { default: '<p class="slot">内容</p>' },
    })
    expect(wrapper.element.tagName).toBe('FORM')
    expect(wrapper.classes()).toContain('rs-form')
    expect(wrapper.find('.slot').text()).toBe('内容')
  })

  it('applies gap, maxWidth, and labelPosition classes', () => {
    const wrapper = mount(RsForm, {
      props: { gap: 'lg', maxWidth: 'sm', labelPosition: 'left' },
    })
    expect(wrapper.classes()).toContain('rs-form--gap-lg')
    expect(wrapper.classes()).toContain('rs-form--max-sm')
    expect(wrapper.classes()).toContain('rs-form--label-left')
  })

  it('validate returns valid when all fields pass', async () => {
    const Host = defineComponent({
      components: { RsForm, RsInput },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const email = ref('user@example.com')
        return { formRef, email }
      },
      template: `
        <RsForm ref="formRef">
          <RsInput v-model="email" rule="email" required />
        </RsForm>
      `,
    })
    const wrapper = mount(Host)
    await flushPromises()
    const result = await wrapper.vm.formRef!.validate()
    expect(result.valid).toBe(true)
    wrapper.unmount()
  })

  it('validate returns invalid when a field fails', async () => {
    const Host = defineComponent({
      components: { RsForm, RsInput },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const email = ref('not-an-email')
        return { formRef, email }
      },
      template: `
        <RsForm ref="formRef">
          <RsInput v-model="email" rule="email" required />
        </RsForm>
      `,
    })
    const wrapper = mount(Host)
    await flushPromises()
    const result = await wrapper.vm.formRef!.validate()
    expect(result.valid).toBe(false)
    wrapper.unmount()
  })

  it('resetFields restores initial values', async () => {
    const Host = defineComponent({
      components: { RsForm, RsInput },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const name = ref('初始值')
        return { formRef, name }
      },
      template: `
        <RsForm ref="formRef">
          <RsInput v-model="name" />
        </RsForm>
      `,
    })
    const wrapper = mount(Host)
    await flushPromises()
    wrapper.vm.name = '已修改'
    await flushPromises()
    wrapper.vm.formRef!.resetFields()
    await flushPromises()
    expect(wrapper.vm.name).toBe('初始值')
    wrapper.unmount()
  })

  it('clearValidation clears input error state', async () => {
    const Host = defineComponent({
      components: { RsForm, RsInput },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const email = ref('bad')
        return { formRef, email }
      },
      template: `
        <RsForm ref="formRef">
          <RsInput v-model="email" rule="email" required />
        </RsForm>
      `,
    })
    const wrapper = mount(Host)
    await flushPromises()
    await wrapper.vm.formRef!.validate()
    await flushPromises()
    expect(wrapper.find('.rs-input-group--invalid').exists()).toBe(true)
    wrapper.vm.formRef!.clearValidation()
    await flushPromises()
    expect(wrapper.find('.rs-input-group--invalid').exists()).toBe(false)
    wrapper.unmount()
  })

  it('propagates disabled to child inputs', async () => {
    const wrapper = mount(RsForm, {
      props: { disabled: true },
      slots: { default: '<RsInput model-value="只读" />' },
      global: { components: { RsInput } },
    })
    await flushPromises()
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('propagates size to child inputs without explicit size', async () => {
    const wrapper = mount(RsForm, {
      props: { size: 'sm' },
      slots: { default: '<RsInput model-value="" />' },
      global: { components: { RsInput } },
    })
    await flushPromises()
    expect(wrapper.find('.rs-input-group--sm').exists()).toBe(true)
    wrapper.unmount()
  })

  it('validates required select field', async () => {
    const Host = defineComponent({
      components: { RsForm, RsSelect },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const role = ref('')
        return { formRef, role, roleOptions }
      },
      template: `
        <RsForm ref="formRef">
          <RsSelect v-model="role" :options="roleOptions" required />
        </RsForm>
      `,
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const invalid = await wrapper.vm.formRef!.validate()
    expect(invalid.valid).toBe(false)
    wrapper.vm.role = 'member'
    await flushPromises()
    const valid = await wrapper.vm.formRef!.validate()
    expect(valid.valid).toBe(true)
    wrapper.unmount()
  })
})
