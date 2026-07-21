<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RsButton from '../RsButton.vue'
import RsIcon from '../RsIcon.vue'
import RsPopover from '../RsPopover.vue'
import RsTableCellEditor from './RsTableCellEditor.vue'

const props = defineProps<{
  columnTitle: string
  filterLabel: string
  placeholder: string
  clearLabel: string
  applyLabel: string
  active: boolean
}>()

const model = defineModel<string>({ default: '' })

const open = ref(false)
const draft = ref(model.value)

watch(open, (value) => {
  if (value) draft.value = model.value
})

watch(model, (value) => {
  if (!open.value) draft.value = value
})

const ariaLabel = computed(() => props.filterLabel.replace('{title}', props.columnTitle))

function apply() {
  model.value = draft.value
  open.value = false
}

function clear() {
  draft.value = ''
  model.value = ''
  open.value = false
}

function onEditorEnter(): void {
  apply()
}
</script>

<template>
  <RsPopover v-model:open="open" side="bottom" align="end" width="md" lazy-mount>
    <button
      type="button"
      class="rs-table__filter"
      :class="{ 'rs-table__filter--active': active }"
      :title="ariaLabel"
      :aria-label="ariaLabel"
      @click.stop
    >
      <RsIcon name="list-filter" size="sm" />
    </button>
    <template #content>
      <div class="rs-table-header-filter">
        <p class="rs-table-header-filter__title">{{ columnTitle }}</p>
        <div class="rs-table-header-filter__field">
          <RsTableCellEditor
            v-model="draft"
            value-type="text"
            variant="field"
            size="sm"
            commit-on="enter"
            :placeholder="placeholder"
            @commit="onEditorEnter"
          />
        </div>
        <div class="rs-table-header-filter__actions">
          <RsButton size="sm" variant="ghost" @click="clear">{{ clearLabel }}</RsButton>
          <RsButton size="sm" @click="apply">{{ applyLabel }}</RsButton>
        </div>
      </div>
    </template>
  </RsPopover>
</template>

<style scoped>
.rs-table-header-filter {
  overflow: visible;
}
.rs-table-header-filter__title {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-fg);
}
.rs-table-header-filter__field {
  overflow: visible;
}
/* Popover 内避免 focus ring 外扩 box-shadow 被裁切，改用 border 高亮 */
.rs-table-header-filter__field :deep(.rs-input-group:focus-within) {
  box-shadow: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
}
.rs-table-header-filter__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--rs-space-xs);
  margin-top: 0.5rem;
}
</style>
