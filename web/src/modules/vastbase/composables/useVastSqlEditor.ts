/**
 * Vastbase 查询编辑器：薄包装公共 useSqlQueryEditor。
 * Monaco：未迁 LSP，静默内置 sql（不再挂 pgsql Worker）。
 */
import { type Ref } from 'vue'
import type { SqlServerProfile } from '@/modules/sql-editor/capabilities'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useSqlQueryEditor } from '@/modules/database/composables/useSqlQueryEditor'

export function useVastSqlEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  getDialect?: () => SqlServerProfile | null
}) {
  return useSqlQueryEditor({
    sqlText: options.sqlText,
    active: options.active,
    onRun: options.onRun,
    getSuggestScope: options.getSuggestScope,
    getDialect: options.getDialect,
    editSource: 'vast-sql-edit',
  })
}
