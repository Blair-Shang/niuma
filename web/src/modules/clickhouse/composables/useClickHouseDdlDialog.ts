import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useClickHouseDdlActionStore } from '@/modules/clickhouse/stores/ddl-actions'

/** ClickHouse DDL 对话框与 store 的通用绑定。 */
export function useClickHouseDdlDialog() {
  const store = useClickHouseDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
