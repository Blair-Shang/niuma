/**
 * 只读单元格查看：供查询结果 / 不可编辑浏览格双击打开。
 * - 打开时写入完整文本给 CodeMirror；关闭清空 draft，避免常驻第二份大字符串
 * - 二进制只显示摘要 + 短 hex 头，不把整段 base64 塞进编辑器
 * - 文案默认走 modules.database.cellView 多语言；方言可按需覆盖
 */
import { copyTextToClipboard, type RsTableColumn } from '@niuma/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  formatBrowseBinSummary,
  formatBrowseBinViewText,
  isBrowseBinCell,
} from '../utils/browse-cell-format'

export interface CellViewDialogLabels {
  viewTitle: string
  close: string
  copyFull: string
  copied: string
}

function pickLabel(override: string | undefined, fallback: string): string {
  const v = override?.trim()
  return v ? v : fallback
}

function rawToEditorText(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    return String(raw)
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw, null, 2)
    } catch {
      return String(raw)
    }
  }
  return String(raw)
}

export function useCellViewDialog(getLabels?: () => Partial<CellViewDialogLabels>) {
  const { t } = useI18n()
  const open = ref(false)
  const draft = ref('')
  const title = ref('')
  /** 原始单元格引用（非拷贝），供复制全文；关闭时置空 */
  const sourceRaw = ref<unknown>(undefined)

  function labels(): CellViewDialogLabels {
    const override = getLabels?.() ?? {}
    return {
      viewTitle: pickLabel(override.viewTitle, t('modules.database.cellView.viewTitle')),
      close: pickLabel(override.close, t('modules.database.cellView.close')),
      copyFull: pickLabel(override.copyFull, t('modules.database.cellView.copyFull')),
      copied: pickLabel(override.copied, t('modules.database.cellView.copied')),
    }
  }

  function clearPayload(): void {
    draft.value = ''
    sourceRaw.value = undefined
  }

  watch(open, (value) => {
    if (value) return
    clearPayload()
  })

  function openCell<T extends Record<string, unknown>>(
    row: T,
    column: RsTableColumn<T>,
  ): void {
    const raw = row[String(column.key)]
    sourceRaw.value = raw
    title.value = String(column.title ?? column.key)

    if (isBrowseBinCell(raw)) {
      draft.value = formatBrowseBinViewText(raw)
    } else {
      draft.value = rawToEditorText(raw)
    }
    open.value = true
  }

  async function copyFull(): Promise<boolean> {
    const raw = sourceRaw.value
    if (isBrowseBinCell(raw)) {
      // 二进制不复制整段 base64（体积大）；复制摘要
      return copyTextToClipboard(formatBrowseBinSummary(raw))
    }
    return copyTextToClipboard(rawToEditorText(raw))
  }

  return {
    open,
    draft,
    title,
    labels,
    openCell,
    copyFull,
  }
}
