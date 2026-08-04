/**
 * 浏览网格大字段弹窗：确认 → stageCell（草稿），不写库。
 * 不可编辑双击走 openView（只读完整内容），与查询结果查看策略一致。
 * 文案默认走 modules.database 多语言；方言可按需覆盖。
 */
import {
  copyTextToClipboard,
  type RsTableColumn,
  type RsTableStagedCell,
  isNullDraft,
} from '@niuma/ui'
import { ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowseDataRow } from '../types/browse-data'
import {
  formatBrowseBinSummary,
  formatBrowseBinViewText,
  isBrowseBinCell,
} from '../utils/browse-cell-format'

type StageableTable = {
  stageCell: (cell: RsTableStagedCell) => void
}

export interface BrowseCellEditorDialogLabels {
  apply: string
  cancel: string
  hint: string
  viewTitle?: string
  copyFull?: string
  copied?: string
}

function pickLabel(override: string | undefined, fallback: string): string {
  const v = override?.trim()
  return v ? v : fallback
}

/** 原始值 → 弹窗可编辑文本（NULL 显示为空，对象 pretty JSON）。 */
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

export function useBrowseCellDialog(
  tableRef: Ref<StageableTable | null | undefined>,
  getLabels?: () => Partial<BrowseCellEditorDialogLabels>,
) {
  const { t } = useI18n()
  const open = ref(false)
  const draft = ref('')
  const readonly = ref(false)
  const title = ref('')
  const pending = ref<{
    rowKey: string
    colKey: string
    rowIndex: number
    original: unknown
  } | null>(null)

  function labels(): BrowseCellEditorDialogLabels {
    const override = getLabels?.() ?? {}
    return {
      apply: pickLabel(override.apply, t('modules.database.cellEditor.apply')),
      cancel: pickLabel(override.cancel, t('modules.database.cellEditor.cancel')),
      hint: pickLabel(override.hint, t('modules.database.cellEditor.applyHint')),
      viewTitle: pickLabel(override.viewTitle, t('modules.database.cellView.viewTitle')),
      copyFull: pickLabel(override.copyFull, t('modules.database.cellEditor.copyFull')),
      copied: pickLabel(override.copied, t('modules.database.cellEditor.copied')),
    }
  }

  function clearPayload(): void {
    pending.value = null
    draft.value = ''
  }

  // 关闭弹窗（含标题栏 X）时释放 pending / 大字段草稿，避免残留引用
  watch(open, (value) => {
    if (value) return
    clearPayload()
  })

  function onCellEditDialog(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index: number,
    initialText: string,
  ): void {
    const raw = row[String(column.key)]
    const isBin = isBrowseBinCell(raw)
    readonly.value = isBin
    title.value = String(column.title ?? column.key)

    if (isBin) {
      draft.value = formatBrowseBinViewText(raw)
    } else if (isNullDraft(initialText)) {
      draft.value = ''
    } else if (initialText && initialText !== rawToEditorText(raw)) {
      // 已有 staged 草稿（与原始值不同）→ 回显草稿
      draft.value = initialText
    } else {
      draft.value = rawToEditorText(raw)
    }

    pending.value = {
      rowKey: String(row.__rowKey ?? ''),
      colKey: String(column.key),
      rowIndex: index,
      original: raw,
    }
    open.value = true
  }

  /** 只读查看：完整文本进 CodeMirror；关闭即释放 draft */
  function openView(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index = 0,
  ): void {
    const raw = row[String(column.key)]
    readonly.value = true
    title.value = String(column.title ?? column.key)

    if (isBrowseBinCell(raw)) {
      draft.value = formatBrowseBinViewText(raw)
    } else {
      draft.value = rawToEditorText(raw)
    }

    pending.value = {
      rowKey: String(row.__rowKey ?? ''),
      colKey: String(column.key),
      rowIndex: index,
      original: raw,
    }
    open.value = true
  }

  function onApply(value: string): void {
    const ctx = pending.value
    const table = tableRef.value
    pending.value = null
    if (!ctx || !table || readonly.value) return
    table.stageCell({
      rowKey: ctx.rowKey,
      colKey: ctx.colKey,
      rowIndex: ctx.rowIndex,
      draft: value,
      original: ctx.original,
    })
  }

  function onCancel(): void {
    pending.value = null
  }

  function openReadonlyBin(row: BrowseDataRow, column: RsTableColumn<BrowseDataRow>): void {
    const raw = row[String(column.key)]
    if (!isBrowseBinCell(raw)) return
    openView(row, column, Number(row.__rowIndex ?? 0))
  }

  async function copyFull(): Promise<boolean> {
    const raw = pending.value?.original
    if (isBrowseBinCell(raw)) {
      return copyTextToClipboard(formatBrowseBinSummary(raw))
    }
    return copyTextToClipboard(rawToEditorText(raw))
  }

  return {
    open,
    draft,
    readonly,
    title,
    labels,
    onCellEditDialog,
    openView,
    onApply,
    onCancel,
    openReadonlyBin,
    copyFull,
  }
}
