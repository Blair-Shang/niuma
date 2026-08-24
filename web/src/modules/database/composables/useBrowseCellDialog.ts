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
  extractBrowseLobText,
  formatBrowseBinSummary,
  formatBrowseBinViewText,
  formatBrowseLobSummary,
  getBrowseLobMarker,
  isBrowseBinCell,
  isBrowseBinaryLobCell,
  isBrowseLobCell,
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

/** RsTable 有 formatter 时 resolveCellEditText 会对对象 JSON.stringify，勿当成 staged 草稿。 */
function isJsonEchoOfRaw(raw: unknown, text: string): boolean {
  if (!raw || typeof raw !== 'object') return false
  try {
    return text === JSON.stringify(raw) || text === JSON.stringify(raw, null, 2)
  } catch {
    return false
  }
}

/** 字符串形态的 `$lob` 包装（偶发序列化）→ 解析后再取 preview。 */
function parseLobMarkerText(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('"$lob"')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isBrowseLobCell(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 原始值 → 弹窗可编辑文本（NULL 显示为空；CLOB `$lob` 取 preview；其余对象 pretty JSON）。 */
function rawToEditorText(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') {
    const asLob = parseLobMarkerText(raw)
    if (asLob) return extractBrowseLobText(asLob)
    return raw
  }
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    return String(raw)
  }
  if (isBrowseBinaryLobCell(raw)) {
    return isBrowseBinCell(raw) ? formatBrowseBinViewText(raw) : formatBrowseLobSummary(raw)
  }
  if (isBrowseLobCell(raw)) {
    return extractBrowseLobText(raw)
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

export type BrowseResolveFullCellValue = (ctx: {
  row: BrowseDataRow
  column: RsTableColumn<BrowseDataRow>
  index: number
  raw: unknown
}) => Promise<unknown | null | undefined>

export function useBrowseCellDialog(
  tableRef: Ref<StageableTable | null | undefined>,
  getLabels?: () => Partial<BrowseCellEditorDialogLabels>,
  resolveFullCellValue?: BrowseResolveFullCellValue,
) {
  const { t } = useI18n()
  const open = ref(false)
  const draft = ref('')
  const readonly = ref(false)
  const title = ref('')
  const loadingFull = ref(false)
  const pending = ref<{
    rowKey: string
    colKey: string
    rowIndex: number
    original: unknown
  } | null>(null)

  async function maybeLoadFull(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index: number,
    raw: unknown,
  ): Promise<unknown> {
    if (!resolveFullCellValue || !getBrowseLobMarker(raw)?.truncated) return raw
    loadingFull.value = true
    try {
      const next = await resolveFullCellValue({ row, column, index, raw })
      return next === undefined || next === null ? raw : next
    } catch {
      return raw
    } finally {
      loadingFull.value = false
    }
  }

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

  function applyDialogContent(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index: number,
    raw: unknown,
    initialText: string | undefined,
    forceReadonly: boolean,
  ): void {
    const isBin = isBrowseBinaryLobCell(raw)
    readonly.value = forceReadonly || isBin
    title.value = String(column.title ?? column.key)

    const fromRaw = rawToEditorText(raw)
    if (isBin) {
      draft.value = isBrowseBinCell(raw)
        ? formatBrowseBinViewText(raw)
        : formatBrowseLobSummary(raw)
    } else if (initialText != null && isNullDraft(initialText)) {
      draft.value = ''
    } else if (
      initialText &&
      initialText !== fromRaw &&
      !isJsonEchoOfRaw(raw, initialText) &&
      !parseLobMarkerText(initialText)
    ) {
      // 已有 staged 草稿（与原始值不同）→ 回显草稿；勿把 `$lob` JSON.stringify 当草稿
      draft.value = initialText
    } else {
      draft.value = fromRaw
    }

    pending.value = {
      rowKey: String(row.__rowKey ?? ''),
      colKey: String(column.key),
      rowIndex: index,
      original: raw,
    }
    open.value = true
  }

  function onCellEditDialog(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index: number,
    initialText: string,
  ): void {
    const raw = row[String(column.key)]
    // 先开弹窗展示预览，再异步拉全量（截断 CLOB）
    applyDialogContent(row, column, index, raw, initialText, false)
    void maybeLoadFull(row, column, index, raw).then((full) => {
      if (full === raw || !pending.value) return
      if (pending.value.rowKey !== String(row.__rowKey ?? '')) return
      if (pending.value.colKey !== String(column.key)) return
      applyDialogContent(row, column, index, full, undefined, false)
      // 同步网格单元格，避免 Apply 仍用截断 preview
      row[String(column.key)] = full
      const ri = Number(row.__rowIndex)
      if (Number.isFinite(ri) && ri >= 0) {
        /* browse pane 会通过 row 引用看到更新 */
      }
    })
  }

  /** 只读查看：完整文本进 CodeMirror；关闭即释放 draft */
  function openView(
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index = 0,
  ): void {
    const raw = row[String(column.key)]
    applyDialogContent(row, column, index, raw, undefined, true)
    void maybeLoadFull(row, column, index, raw).then((full) => {
      if (full === raw || !pending.value) return
      if (pending.value.rowKey !== String(row.__rowKey ?? '')) return
      if (pending.value.colKey !== String(column.key)) return
      applyDialogContent(row, column, index, full, undefined, true)
      row[String(column.key)] = full
    })
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
    if (!isBrowseBinaryLobCell(raw)) return
    openView(row, column, Number(row.__rowIndex ?? 0))
  }

  async function copyFull(): Promise<boolean> {
    const raw = pending.value?.original
    if (isBrowseBinCell(raw)) {
      return copyTextToClipboard(formatBrowseBinSummary(raw))
    }
    if (isBrowseBinaryLobCell(raw)) {
      return copyTextToClipboard(formatBrowseLobSummary(raw))
    }
    return copyTextToClipboard(rawToEditorText(raw))
  }

  return {
    open,
    draft,
    readonly,
    title,
    loadingFull,
    labels,
    onCellEditDialog,
    openView,
    onApply,
    onCancel,
    openReadonlyBin,
    copyFull,
  }
}
