import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useSqliteDdlActionStore } from '@/modules/sqlite/stores/ddl-actions'

/** SQLite DDL 对话框与 store 的通用绑定。 */
export function useSqliteDdlDialog() {
  const store = useSqliteDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
