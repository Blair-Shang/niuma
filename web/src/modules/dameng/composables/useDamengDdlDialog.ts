import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useDamengDdlActionStore } from '@/modules/dameng/stores/ddl-actions'

/** 达梦 DDL 对话框与 store 的通用绑定。 */
export function useDamengDdlDialog() {
  const store = useDamengDdlActionStore()
  const { pending, busy } = storeToRefs(store)

  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v && !busy.value) store.clear()
    },
  })

  return { store, pending, busy, open }
}
