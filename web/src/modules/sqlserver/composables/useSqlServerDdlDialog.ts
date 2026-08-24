import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSqlServerDdlActionStore } from '@/modules/sqlserver/stores/ddl-actions'

/** SQL Server DDL 对话框与 store 的通用绑定。 */
export function useSqlServerDdlDialog() {
  const store = useSqlServerDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
