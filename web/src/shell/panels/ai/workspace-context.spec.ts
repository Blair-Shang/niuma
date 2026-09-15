import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDiagnostic,
  clearEditorSelection,
  editorSelectionBelongsToTab,
  latestDiagnosticForTab,
  publishDiagnostic,
  publishEditorSelection,
} from './workspace-context'

describe('workspace-context auto-attach scope', () => {
  afterEach(() => {
    clearDiagnostic()
    clearEditorSelection()
  })

  it('does not auto-pick SSH diagnostic when the active tab is a query page', () => {
    publishDiagnostic({
      id: 'ssh-term:s1',
      label: 'SSH Terminal',
      text: 'lost',
      kind: 'ssh',
      tabId: 'tab-ssh',
    })
    expect(latestDiagnosticForTab('tab-sql')).toBeNull()
  })

  it('latestDiagnosticForTab ignores newer diagnostics from other tabs', () => {
    publishDiagnostic({
      id: 'ssh-term:s1',
      label: 'SSH Terminal',
      text: 'lost',
      kind: 'ssh',
      tabId: 'tab-ssh',
    })
    publishDiagnostic({
      id: 'diag:sql',
      label: 'SQL 诊断 1 条',
      text: 'syntax error',
      kind: 'sql_markers',
      tabId: 'tab-sql',
    })

    expect(latestDiagnosticForTab('tab-sql')?.label).toBe('SQL 诊断 1 条')
    expect(latestDiagnosticForTab('tab-ssh')?.label).toBe('SSH Terminal')
    expect(latestDiagnosticForTab('tab-other')).toBeNull()
    expect(latestDiagnosticForTab(null)).toBeNull()
  })

  it('editorSelectionBelongsToTab rejects leftover terminal selection after switching tabs', () => {
    publishEditorSelection({
      tabId: 'tab-ssh',
      text: 'ls -la',
      source: 'terminal',
    })
    expect(editorSelectionBelongsToTab('tab-ssh')).toBe(true)
    expect(editorSelectionBelongsToTab('tab-sql')).toBe(false)
    expect(editorSelectionBelongsToTab(null)).toBe(false)
  })
})
