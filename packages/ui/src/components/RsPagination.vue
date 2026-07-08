<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RsButton from './RsButton.vue'
import RsInput from './RsInput.vue'
import RsSelect from './RsSelect.vue'
import { clampPage, DEFAULT_PAGE_SIZE_OPTIONS, getPageCount, getPaginationRange } from './pagination-utils'
import { useRsI18n } from '../composables/useRsI18n'

export type RsPaginationSize = 'sm' | 'md'

const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: 20 })

const props = withDefaults(
  defineProps<{
    total: number
    siblingCount?: number
    showSummary?: boolean
    showPageSize?: boolean
    showQuickJumper?: boolean
    pageSizeOptions?: readonly number[]
    disabled?: boolean
    size?: RsPaginationSize
  }>(),
  {
    siblingCount: 1,
    showSummary: true,
    showPageSize: false,
    showQuickJumper: false,
    pageSizeOptions: () => DEFAULT_PAGE_SIZE_OPTIONS,
    disabled: false,
    size: 'md',
  },
)

const { t } = useRsI18n()
const jumpPageInput = ref(String(page.value))
const pageCount = computed(() => getPageCount(props.total, pageSize.value))
const range = computed(() => getPaginationRange(page.value, pageCount.value, props.siblingCount))
const summaryText = computed(() => t('pagination.summary', 'Total {total} items').replace('{total}', String(props.total)))
const pageSizeSelectValue = computed({
  get: () => String(pageSize.value),
  set: (value: string) => {
    pageSize.value = Number(value)
  },
})
const pageSizeSelectOptions = computed(() =>
  props.pageSizeOptions.map((option) => ({
    label: `${option} / ${t('pagination.page')}`,
    value: String(option),
  })),
)
const showJumper = computed(() => props.showQuickJumper && pageCount.value > 1)

watch(pageCount, (count) => {
  page.value = clampPage(page.value, count)
})

watch(page, (value) => {
  jumpPageInput.value = String(value)
})

function go(next: number): void {
  if (props.disabled) return
  page.value = clampPage(next, pageCount.value)
}

function confirmJump(): void {
  if (props.disabled) return
  const parsed = Number.parseInt(jumpPageInput.value.trim(), 10)
  if (Number.isNaN(parsed)) {
    jumpPageInput.value = String(page.value)
    return
  }
  go(parsed)
  jumpPageInput.value = String(page.value)
}
</script>

<template>
  <nav class="rs-pagination" :class="`rs-pagination--${size}`" :aria-label="t('pagination.label')">
    <span v-if="showSummary" class="rs-pagination__summary">
      {{ summaryText }}
    </span>
    <div class="rs-pagination__buttons">
      <RsButton variant="ghost" size="sm" :disabled="disabled || page <= 1" @click="go(page - 1)">
        {{ t('pagination.prev') }}
      </RsButton>
      <template v-for="(item, index) in range" :key="`${item}-${index}`">
        <span v-if="item === 'ellipsis'" class="rs-pagination__ellipsis">...</span>
        <RsButton
          v-else
          :variant="item === page ? 'primary' : 'ghost'"
          size="sm"
          :disabled="disabled"
          @click="go(item)"
        >
          {{ item }}
        </RsButton>
      </template>
      <RsButton variant="ghost" size="sm" :disabled="disabled || page >= pageCount" @click="go(page + 1)">
        {{ t('pagination.next') }}
      </RsButton>
    </div>
    <div v-if="showJumper" class="rs-pagination__jumper">
      <span class="rs-pagination__jumper-label">{{ t('pagination.jumpTo') }}</span>
      <div class="rs-pagination__jumper-input">
        <RsInput
          v-model="jumpPageInput"
          size="sm"
          :disabled="disabled"
          @keydown.enter="confirmJump"
        />
      </div>
      <span v-if="t('pagination.jumpPageSuffix')" class="rs-pagination__jumper-suffix">
        {{ t('pagination.jumpPageSuffix') }}
      </span>
      <RsButton
        variant="ghost"
        size="sm"
        class="rs-pagination__jumper-btn"
        :disabled="disabled"
        @click="confirmJump"
      >
        {{ t('pagination.jumpConfirm') }}
      </RsButton>
    </div>
    <div v-if="showPageSize" class="rs-pagination__size">
      <RsSelect
        v-model="pageSizeSelectValue"
        :options="pageSizeSelectOptions"
        size="sm"
        :disabled="disabled"
        :placeholder="t('select.placeholder')"
      />
    </div>
  </nav>
</template>

<style scoped>
.rs-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
.rs-pagination__buttons {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
}
.rs-pagination__ellipsis {
  padding: 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-control-height-sm);
}
.rs-pagination__jumper {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
}
.rs-pagination__jumper-label,
.rs-pagination__jumper-suffix {
  flex-shrink: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-tight);
}
.rs-pagination__jumper-input {
  width: 2.75rem;
}
.rs-pagination__jumper-input :deep(.rs-input-field) {
  width: 100%;
}
.rs-pagination__jumper-btn {
  flex-shrink: 0;
}
.rs-pagination__size {
  width: 7.25rem;
  min-width: 7.25rem;
}
</style>
