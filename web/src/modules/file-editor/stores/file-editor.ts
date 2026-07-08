import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FileOpenSpec } from '@/api/types/file-editor'
import { fileProviderRegistry } from '@/modules/file-editor/providers/registry'
import type { FileDocument } from '@/modules/file-editor/types'
import { basenameFromPath, detectLanguageFromPath } from '@/modules/file-editor/utils/detectLanguage'
import { documentKeyForSpec } from '@/modules/file-editor/utils/documentKey'

function newDocId(): string {
  return `doc_${crypto.randomUUID().slice(0, 8)}`
}

function pathFromSpec(spec: FileOpenSpec): string {
  const path = spec.context.path
  return typeof path === 'string' ? path : ''
}

/**
 * 文件工作台 Tab 状态（仅在工作台 CEF 窗口内使用，纯内存）。
 *
 * 跨窗口打开由 Platform `fileEditor.openTab` + 事件 `fileEditor.tab.open` 驱动。
 * **不持久化**：关闭工作台窗口后 Tab 与未保存标记全部丢弃。
 */
export const useFileEditorStore = defineStore('file-editor', () => {
  const documents = ref<FileDocument[]>([])
  const activeDocId = ref<string | null>(null)

  const activeDocument = computed(() =>
    documents.value.find((d) => d.docId === activeDocId.value) ?? null,
  )

  const hasDirty = computed(() =>
    documents.value.some((d) => d.content !== d.savedContent),
  )

  /** 按 spec 去重打开：已存在则聚焦，否则新建 Tab 并加载 */
  async function openTab(spec: FileOpenSpec): Promise<void> {
    const key = documentKeyForSpec(spec)
    const existing = documents.value.find((d) => documentKeyForSpec(d.spec) === key)
    if (existing) {
      activeDocId.value = existing.docId
      // 同一文件查看 / 编辑共用 Tab：后打开的编辑请求可升级为可写。
      existing.readonly = spec.readonly === true
      return
    }

    const path = pathFromSpec(spec)
    const label = spec.label ?? basenameFromPath(path)
    const doc: FileDocument = {
      docId: newDocId(),
      spec,
      label,
      readonly: spec.readonly === true,
      content: '',
      savedContent: '',
      language: detectLanguageFromPath(path),
      status: 'loading',
    }
    documents.value.push(doc)
    activeDocId.value = doc.docId
    await loadDocument(doc.docId)
  }

  /** 从后端读取文件内容 */
  async function loadDocument(docId: string): Promise<void> {
    const doc = documents.value.find((d) => d.docId === docId)
    if (!doc) {
      return
    }
    doc.status = 'loading'
    doc.error = undefined
    try {
      const provider = fileProviderRegistry.require(doc.spec.provider)
      const result = await provider.read(doc.spec.context)
      doc.content = result.content
      doc.savedContent = result.content
      doc.size = result.size
      doc.sourceLabel = provider.sourceLabel?.(doc.spec.context)
      doc.status = 'ready'
    } catch (e) {
      doc.status = 'error'
      doc.error = e instanceof Error ? e.message : String(e)
    }
  }

  /** 将当前文档写回来源 */
  async function saveDocument(docId?: string): Promise<boolean> {
    const doc = documents.value.find((d) => d.docId === (docId ?? activeDocId.value))
    if (!doc || doc.readonly || doc.status === 'saving') {
      return false
    }
    doc.status = 'saving'
    doc.error = undefined
    try {
      const provider = fileProviderRegistry.require(doc.spec.provider)
      await provider.write(doc.spec.context, doc.content)
      doc.savedContent = doc.content
      doc.status = 'ready'
      return true
    } catch (e) {
      doc.status = 'error'
      doc.error = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  function updateContent(docId: string, content: string): void {
    const doc = documents.value.find((d) => d.docId === docId)
    if (!doc || doc.readonly) {
      return
    }
    doc.content = content
  }

  function setReadonly(docId: string, readonly: boolean): void {
    const doc = documents.value.find((d) => d.docId === docId)
    if (doc) {
      doc.readonly = readonly
    }
  }

  function closeTab(docId: string): boolean {
    const idx = documents.value.findIndex((d) => d.docId === docId)
    if (idx < 0) {
      return false
    }
    documents.value.splice(idx, 1)
    if (activeDocId.value === docId) {
      const next = documents.value[Math.min(idx, documents.value.length - 1)]
      activeDocId.value = next?.docId ?? null
    }
    return true
  }

  function activateTab(docId: string): void {
    if (documents.value.some((d) => d.docId === docId)) {
      activeDocId.value = docId
    }
  }

  return {
    documents,
    activeDocId,
    activeDocument,
    hasDirty,
    openTab,
    loadDocument,
    saveDocument,
    updateContent,
    setReadonly,
    closeTab,
    activateTab,
  }
})
