import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { usePostgresDdlActionStore } from '@/modules/postgres/stores/ddl-actions'

/** Postgres DDL 对话框与 store 的通用绑定。 */
export function usePostgresDdlDialog() {
  const store = usePostgresDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
