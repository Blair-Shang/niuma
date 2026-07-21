import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useVastDdlActionStore } from '@/modules/vastbase/stores/ddl-actions'

/** Vastbase DDL 对话框与 store 的通用绑定。 */
export function useVastDdlDialog() {
  const store = useVastDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
