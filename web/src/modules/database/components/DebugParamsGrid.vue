<script setup lang="ts">
/**
 * 调试调用参数网格：名称 / 类型 / NULL / 值（对齐 Navicat）。
 */
import { RsCheckbox, RsIcon, RsInput } from '@niuma/ui'
import type { DebugShellLabels, DebugShellParamRow } from '../types/debug-shell'

withDefaults(
  defineProps<{
    labels: DebugShellLabels
    params: DebugShellParamRow[]
    /** 预览串（如序列化后的 callArgs） */
    preview?: string
    disabled?: boolean
  }>(),
  {
    preview: '',
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:param-null': [index: number, isNull: boolean]
  'update:param-value': [index: number, value: string]
}>()

function onNull(param: DebugShellParamRow, checked: boolean | unknown): void {
  emit('update:param-null', param.index, !!checked)
}

function onValue(param: DebugShellParamRow, value: string | unknown): void {
  emit('update:param-value', param.index, String(value ?? ''))
}
</script>

<template>
  <div class="nm-debug-params">
    <div class="nm-debug-params__head">
      <span class="nm-debug-params__title">
        <RsIcon name="list" :size="12" />
        {{ labels.paramsTitle }}
      </span>
      <span v-if="params.length === 0" class="nm-debug-params__empty">
        {{ labels.noParams }}
      </span>
      <span v-else class="nm-debug-params__preview" :title="preview">
        {{ labels.paramsPreview }}:
        {{ preview || '—' }}
      </span>
    </div>
    <div v-if="params.length > 0" class="nm-debug-params__table-wrap">
      <table class="nm-debug-params__table">
        <thead>
          <tr>
            <th class="nm-debug-params__col-idx">#</th>
            <th class="nm-debug-params__col-name">{{ labels.colParamName }}</th>
            <th class="nm-debug-params__col-type">{{ labels.colParamType }}</th>
            <th class="nm-debug-params__col-null">NULL</th>
            <th class="nm-debug-params__col-value">{{ labels.colParamValue }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="param in params" :key="`${param.index}:${param.name}`">
            <td class="nm-debug-params__col-idx">{{ param.index }}</td>
            <td class="nm-debug-params__col-name" :title="param.name">
              {{ param.name }}
              <span v-if="param.mode" class="nm-debug-params__mode">{{ param.mode }}</span>
            </td>
            <td class="nm-debug-params__col-type" :title="param.type">{{ param.type }}</td>
            <td class="nm-debug-params__col-null">
              <RsCheckbox
                :model-value="param.isNull"
                :disabled="disabled"
                @update:model-value="(v) => onNull(param, v)"
              />
            </td>
            <td class="nm-debug-params__col-value">
              <RsInput
                size="sm"
                :model-value="param.value"
                :placeholder="param.isNull ? 'NULL' : labels.paramValuePh"
                :disabled="disabled || param.isNull"
                @update:model-value="(v) => onValue(param, v)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.nm-debug-params {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-debug-params__head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: 0.3rem var(--rs-space-sm);
  min-width: 0;
}

.nm-debug-params__title {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}

.nm-debug-params__empty,
.nm-debug-params__preview {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.nm-debug-params__preview {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-debug-params__table-wrap {
  max-height: 9.5rem;
  overflow: auto;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-debug-params__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rs-font-size-xs);
}

.nm-debug-params__table th,
.nm-debug-params__table td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  text-align: left;
  vertical-align: middle;
}

.nm-debug-params__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--rs-surface);
  color: var(--rs-muted);
  font-weight: 600;
  white-space: nowrap;
}

.nm-debug-params__col-idx {
  width: 2.25rem;
  text-align: right;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.nm-debug-params__col-name {
  width: 8rem;
  max-width: 12rem;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-debug-params__mode {
  margin-left: 0.35rem;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-debug-params__col-type {
  width: 8rem;
  max-width: 12rem;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-debug-params__col-null {
  width: 3.25rem;
  text-align: center;
}

.nm-debug-params__col-value {
  min-width: 10rem;
}

.nm-debug-params__table tbody tr:hover {
  background: color-mix(in srgb, var(--rs-accent, #2563eb) 5%, transparent);
}
</style>
