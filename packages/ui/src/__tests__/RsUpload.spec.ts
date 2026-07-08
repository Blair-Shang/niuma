import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsUpload from '../components/RsUpload.vue'
import {
  formatFileSize,
  isFileAccepted,
  mergeUploadFiles,
  removeUploadFileAt,
  validateUploadFiles,
} from '../components/upload-utils'

function createFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type })
}

async function selectFiles(wrapper: ReturnType<typeof mount>, files: File[]): Promise<void> {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: files,
    configurable: true,
  })
  await input.trigger('change')
}

describe('upload-utils', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('matches accept rules by extension, mime type, and wildcard', () => {
    const txt = createFile('a.txt', 'x')
    const png = createFile('b.png', 'x', 'image/png')
    expect(isFileAccepted(txt, '.txt')).toBe(true)
    expect(isFileAccepted(txt, 'image/*')).toBe(false)
    expect(isFileAccepted(png, 'image/*')).toBe(true)
    expect(isFileAccepted(png, 'text/plain')).toBe(false)
  })

  it('validates accept, maxSize, and maxCount', () => {
    const small = createFile('small.txt', 'hi')
    const large = createFile('large.txt', 'x'.repeat(200))
    const invalidType = createFile('bad.pdf', 'x', 'application/pdf')

    expect(validateUploadFiles([invalidType], { accept: '.txt' }).rejected[0]?.reason).toBe('accept')
    expect(validateUploadFiles([large], { maxSize: 100 }).rejected[0]?.reason).toBe('maxSize')
    expect(
      validateUploadFiles([small, createFile('extra.txt', 'y')], { maxCount: 1 }).rejected[0]?.reason,
    ).toBe('maxCount')
  })

  it('merges and trims files by maxCount', () => {
    const first = createFile('a.txt', 'a')
    const second = createFile('b.txt', 'b')
    expect(mergeUploadFiles([first], [second], 1)).toHaveLength(1)
    expect(mergeUploadFiles([first], [second])).toHaveLength(2)
  })

  it('removes file at index', () => {
    const files = [createFile('a.txt', 'a'), createFile('b.txt', 'b')]
    expect(removeUploadFileAt(files, 0).map((file) => file.name)).toEqual(['b.txt'])
  })
})

describe('RsUpload', () => {
  it('renders default zh-CN label', () => {
    const wrapper = mount(RsUpload)
    expect(wrapper.find('.rs-upload__label').text()).toBe('点击或拖拽文件到此处上传')
  })

  it('renders custom label and hint', () => {
    const wrapper = mount(RsUpload, {
      props: { label: '上传附件', hint: '仅 PDF' },
    })
    expect(wrapper.find('.rs-upload__label').text()).toBe('上传附件')
    expect(wrapper.find('.rs-upload__hint').text()).toBe('仅 PDF')
  })

  it('renders default browse hint when hint is omitted', () => {
    const wrapper = mount(RsUpload)
    expect(wrapper.find('.rs-upload__hint').text()).toBe('或点击浏览本地文件')
  })

  it('uses en-US label inside RsConfigProvider', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () => h(RsUpload),
      },
    })
    expect(wrapper.find('.rs-upload__label').text()).toBe('Click or drag files here to upload')
  })

  it('accepts files and updates model', async () => {
    const wrapper = mount(RsUpload, {
      props: { modelValue: [] },
    })
    const file = createFile('demo.txt', 'hello')
    await selectFiles(wrapper, [file])
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([file])
  })

  it('shows file list with formatted size', async () => {
    const file = createFile('demo.txt', 'hello')
    const wrapper = mount(RsUpload, {
      props: { modelValue: [file] },
    })
    expect(wrapper.find('.rs-upload__file-name').text()).toBe('demo.txt')
    expect(wrapper.find('.rs-upload__file-size').text()).toBe(formatFileSize(file.size))
  })

  it('removes file from list', async () => {
    const first = createFile('a.txt', 'a')
    const second = createFile('b.txt', 'b')
    const wrapper = mount(RsUpload, {
      props: { modelValue: [first, second] },
    })
    await wrapper.find('.rs-upload__file-remove').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([second])
  })

  it('emits reject for invalid files', async () => {
    const wrapper = mount(RsUpload, {
      props: { modelValue: [], accept: '.txt' },
    })
    const invalid = createFile('image.png', 'x', 'image/png')
    await selectFiles(wrapper, [invalid])
    const reject = wrapper.emitted('reject')?.[0]?.[0] as Array<{ reason: string }>
    expect(reject?.[0]?.reason).toBe('accept')
  })

  it('disables input when disabled', () => {
    const wrapper = mount(RsUpload, { props: { disabled: true } })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.rs-upload__dropzone').classes()).toContain('rs-upload__dropzone--disabled')
  })

  it('disables input when maxCount is reached', () => {
    const wrapper = mount(RsUpload, {
      props: {
        modelValue: [createFile('a.txt', 'a'), createFile('b.txt', 'b')],
        maxCount: 2,
      },
    })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.rs-upload__dropzone').classes()).toContain('rs-upload__dropzone--disabled')
  })

  it('binds accept and multiple attributes', () => {
    const wrapper = mount(RsUpload, {
      props: { accept: 'image/*', multiple: true },
    })
    const input = wrapper.find('input')
    expect(input.attributes('accept')).toBe('image/*')
    expect(input.attributes('multiple')).toBeDefined()
  })
})
