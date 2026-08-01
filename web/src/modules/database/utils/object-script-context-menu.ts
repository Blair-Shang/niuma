import type { RsContextMenuItem } from '@niuma/ui'
import type { ObjectScriptContextMenuLabels } from '../types/object-script'

export interface ObjectScriptContextMenuState {
  labels: ObjectScriptContextMenuLabels
  saving: boolean
  hasSelection: boolean
  sqlEmpty: boolean
  canApply?: boolean
  /** 是否展示询问 AI（对齐查询面板） */
  showAskAi?: boolean
}

/** 方言无关的对象脚本右键菜单（执行/格式化/剪贴板/AI；无 Explain 与结果集操作）。 */
export function buildObjectScriptContextMenuItems(
  state: ObjectScriptContextMenuState,
): RsContextMenuItem[] {
  const {
    labels,
    saving,
    hasSelection,
    sqlEmpty,
    canApply = true,
    showAskAi = true,
  } = state

  const applyLabel =
    hasSelection && labels.applySelection ? labels.applySelection : labels.apply

  const items: RsContextMenuItem[] = [
    {
      key: 'apply',
      label: applyLabel,
      icon: 'play',
      shortcut: 'Ctrl+Enter',
      disabled: saving || !canApply || sqlEmpty,
    },
    {
      key: 'format',
      label: labels.format,
      icon: 'braces',
      shortcut: 'Shift+Alt+F',
      disabled: saving,
    },
    {
      key: 'compress',
      label: labels.compress,
      icon: 'minimize-2',
      disabled: saving || sqlEmpty,
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

  return items
}
