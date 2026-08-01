import type { RsContextMenuItem } from '@niuma/ui'
import type { SqlQueryContextMenuLabels } from '../types/sql-query-shell'

export interface SqlQueryContextMenuState {
  labels: SqlQueryContextMenuLabels
  running: boolean
  cancelling: boolean
  hasSelection: boolean
  sqlEmpty: boolean
  hasResultRows: boolean
  hasMore: boolean
  loadingMore: boolean
  /** 是否展示 Explain（部分方言可关） */
  showExplain?: boolean
  /** 是否展示询问 AI */
  showAskAi?: boolean
}

/** 方言无关的查询编辑器右键菜单（文案与状态由调用方注入） */
export function buildSqlQueryContextMenuItems(
  state: SqlQueryContextMenuState,
): RsContextMenuItem[] {
  const {
    labels,
    running,
    cancelling,
    hasSelection,
    sqlEmpty,
    hasResultRows,
    hasMore,
    loadingMore,
    showExplain = true,
    showAskAi = true,
  } = state

  const items: RsContextMenuItem[] = [
    {
      key: 'run',
      label: hasSelection ? labels.runSelection : labels.run,
      icon: 'play',
      shortcut: 'Ctrl+Enter',
      disabled: running,
    },
    {
      key: 'cancel',
      label: labels.cancel,
      icon: 'square',
      disabled: !running || cancelling,
    },
    {
      key: 'format',
      label: labels.format,
      icon: 'braces',
      shortcut: 'Shift+Alt+F',
      disabled: running,
    },
    {
      key: 'compress',
      label: labels.compress,
      icon: 'minimize-2',
      disabled: running || sqlEmpty,
    },
    { key: 'sep-edit', label: '', separator: true },
    {
      key: 'copy',
      label: labels.copy,
      icon: 'copy',
      shortcut: 'Ctrl+C',
    },
    {
      key: 'paste',
      label: labels.paste,
      icon: 'clipboard-paste',
      shortcut: 'Ctrl+V',
    },
  ]

  if (showExplain) {
    items.push(
      { key: 'sep-explain', label: '', separator: true },
      {
        key: 'explain',
        label: labels.explain,
        icon: 'git-compare',
        disabled: running,
      },
      {
        key: 'explainAnalyze',
        label: labels.explainAnalyze,
        icon: 'activity',
        disabled: running,
      },
    )
  }

  if (showAskAi && labels.askAi) {
    items.push(
      { key: 'sep-ai', label: '', separator: true },
      {
        key: 'askAi',
        label: labels.askAi,
        icon: 'bot',
        disabled: !hasSelection && sqlEmpty,
      },
    )
  }

  items.push(
    { key: 'sep-export', label: '', separator: true },
    {
      key: 'exportCsv',
      label: labels.exportCsv,
      icon: 'download',
      disabled: !hasResultRows,
    },
    {
      key: 'fetchMore',
      label: labels.fetchMore,
      icon: 'arrow-down',
      disabled: !hasMore || loadingMore || running,
    },
    {
      key: 'fetchAll',
      label: labels.fetchAll,
      icon: 'arrow-down',
      disabled: !hasMore || loadingMore || running,
    },
  )

  return items
}
