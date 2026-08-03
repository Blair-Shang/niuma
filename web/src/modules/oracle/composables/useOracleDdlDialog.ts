import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useOracleDdlActionStore } from '@/modules/oracle/stores/ddl-actions'

/** Oracle DDL 对话框与 store 的通用绑定。 */
export function useOracleDdlDialog() {
  const store = useOracleDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
