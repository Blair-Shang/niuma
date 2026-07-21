import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useMysqlDdlActionStore } from '@/modules/mysql/stores/ddl-actions'

/** MySQL DDL 对话框与 store 的通用绑定。 */
export function useMysqlDdlDialog() {
  const store = useMysqlDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
