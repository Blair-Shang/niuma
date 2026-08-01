import type { Ref } from 'vue'
import type { SqlServerProfile } from '@/modules/sql-editor/capabilities'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useSqlQueryEditor } from '@/modules/database/composables/useSqlQueryEditor'

/** Oracle P0 uses the built-in SQL editor; Oracle-specific completion is deferred. */
export function useOracleSqlEditor(options: {
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
    editSource: 'oracle-sql-edit',
    prepareLanguage: async () => {},
  })
}
