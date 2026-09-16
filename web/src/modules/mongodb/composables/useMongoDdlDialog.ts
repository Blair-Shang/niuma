import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useMongoDdlActionStore } from '@/modules/mongodb/stores/ddl-actions'

/** MongoDB DDL 对话框与 store 的通用绑定。 */
export function useMongoDdlDialog() {
  const store = useMongoDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
