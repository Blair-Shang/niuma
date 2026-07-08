import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsForm from '../components/RsForm.vue'
import RsSelect from '../components/RsSelect.vue'
import { filterSelectOptions } from '../components/select-utils'

describe('RsSelect', () => {
  const options = [
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'Claude', value: 'claude' },
  ]

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = () => {}
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders trigger with custom placeholder', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '', placeholder: '选择模型' },
    })
    expect(wrapper.find('.rs-select__trigger').exists()).toBe(true)
    expect(wrapper.find('.rs-select__placeholder').text()).toBe('选择模型')
  })

  it('uses zh-CN default placeholder', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '' },
    })
    expect(wrapper.find('.rs-select__placeholder').text()).toBe('请选择')
  })

  it('uses en-US default placeholder inside RsConfigProvider', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () => h(RsSelect, { options, modelValue: '' }),
      },
    })
    expect(wrapper.find('.rs-select__placeholder').text()).toBe('Select')
  })

  it('forwards v-model through Reka ComboboxRoot', async () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '' },
    })
    const root = wrapper.getComponent({ name: 'ComboboxRoot' })
    await root.vm.$emit('update:modelValue', 'claude')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['claude'])
  })

  it('shows selected option label in single mode', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: 'claude' },
    })
    expect(wrapper.find('.rs-select__single-label').text()).toBe('Claude')
  })

  it('applies modifier classes for multiple and searchable', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: [], multiple: true, searchable: true },
    })
    expect(wrapper.find('.rs-select').classes()).toContain('rs-select--multiple')
    expect(wrapper.find('.rs-select').classes()).toContain('rs-select--searchable')
  })

  it('does not render search input while dropdown is closed', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '', searchable: true },
    })
    expect(wrapper.find('.rs-select__search').exists()).toBe(false)
  })

  it('shows clear button when clearable and has value', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: 'gpt-4o', clearable: true },
    })
    expect(wrapper.find('.rs-select__clear').exists()).toBe(true)
  })

  it('clears value when clear button is clicked', async () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: 'gpt-4o', clearable: true },
    })
    await wrapper.find('.rs-select__clear').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })

  it('supports multiple mode tags', () => {
    const wrapper = mount(RsSelect, {
      props: {
        options,
        modelValue: ['gpt-4o', 'claude'],
        multiple: true,
      },
    })
    expect(wrapper.find('.rs-select__tag').exists()).toBe(true)
    expect(wrapper.findAll('.rs-select__tag')).toHaveLength(2)
  })

  it('removes tag in multiple mode', async () => {
    const wrapper = mount(RsSelect, {
      props: {
        options,
        modelValue: ['gpt-4o', 'claude'],
        multiple: true,
      },
    })
    await wrapper.find('.rs-select__tag-remove').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['claude']])
  })

  it('setValue via defineExpose updates model', async () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '' },
    })
    const exposed = wrapper.vm as InstanceType<typeof RsSelect>
    exposed.setValue('claude')
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['claude'])
  })

  it('setValue supports multiple mode', async () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: [], multiple: true },
    })
    const exposed = wrapper.vm as InstanceType<typeof RsSelect>
    exposed.setValue(['gpt-4o', 'claude'])
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['gpt-4o', 'claude']])
  })

  it('shows loading status text when dropdown is open', async () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '', loading: true, searchable: true },
      attachTo: document.body,
    })
    await wrapper.find('.rs-select__trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.rs-select__status')?.textContent).toBe('加载中…')
    wrapper.unmount()
  })

  it('uses custom loading text when dropdown is open', async () => {
    const wrapper = mount(RsSelect, {
      props: {
        options,
        modelValue: '',
        loading: true,
        loadingText: 'Fetching…',
        searchable: true,
      },
      attachTo: document.body,
    })
    await wrapper.find('.rs-select__trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.rs-select__status')?.textContent).toBe('Fetching…')
    wrapper.unmount()
  })

  it('disables trigger when disabled', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: 'gpt-4o', disabled: true },
    })
    expect(wrapper.find('.rs-select__trigger').attributes('data-disabled')).toBeDefined()
  })

  it('validates required field inside RsForm', async () => {
    const Host = defineComponent({
      components: { RsForm, RsSelect },
      setup() {
        const formRef = ref<InstanceType<typeof RsForm> | null>(null)
        const role = ref('')
        return { formRef, role, roleOptions: options }
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
    wrapper.vm.role = 'claude'
    await flushPromises()
    const valid = await wrapper.vm.formRef!.validate()
    expect(valid.valid).toBe(true)
    wrapper.unmount()
  })

  it('enables manual filter when remote', () => {
    const wrapper = mount(RsSelect, {
      props: { options, modelValue: '', searchable: true, remote: true },
    })
    const root = wrapper.getComponent({ name: 'ComboboxRoot' })
    expect(root.props('ignoreFilter')).toBe(true)
  })
})

describe('select-utils', () => {
  const contains = (text: string, search: string) =>
    text.toLowerCase().includes(search.toLowerCase())

  it('filterSelectOptions filters flat and grouped options', () => {
    const grouped = [
      {
        label: '前端',
        options: [
          { label: 'Vue', value: 'vue' },
          { label: 'React', value: 'react' },
        ],
      },
      {
        label: '后端',
        options: [{ label: 'Go', value: 'go' }],
      },
    ]
    const result = filterSelectOptions(grouped, 'vue', contains)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: '前端' })
    if ('options' in result[0]) {
      expect(result[0].options).toHaveLength(1)
      expect(result[0].options[0]?.value).toBe('vue')
    }
  })
})
