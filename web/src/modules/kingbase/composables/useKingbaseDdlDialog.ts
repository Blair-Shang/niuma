import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useKingbaseDdlActionStore } from '@/modules/kingbase/stores/ddl-actions'

/** Kingbase DDL 对话框与 store 的通用绑定。 */
export function useKingbaseDdlDialog() {
  const store = useKingbaseDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
