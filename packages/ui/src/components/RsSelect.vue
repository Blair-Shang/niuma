<script setup lang="ts">

import { computed, ref, watch } from 'vue'

import { useRsI18n } from '../composables/useRsI18n'
import type { RsComponentSize, RsRadius } from '../theme/types'
import { RS_COMPONENT_SIZE_ICON_PX } from '../theme/types'

import RsIcon from './RsIcon.vue'
import { useRsFormContext, useRsFormField } from './form-utils'
import { useResolvedRsComponentSize } from './resolve-size'
import { rsRadiusCss, useResolvedRsRadius } from './resolve-radius'

import {

  buildOptionDisabledMap,

  buildOptionLabelMap,

  filterSelectOptions,

  flattenSelectOptions,

  flattenSelectValues,

  isSelectOptionGroup,
  type RsSelectOptions,
} from './select-utils'

import {

  ComboboxAnchor,

  ComboboxContent,

  ComboboxEmpty,

  ComboboxGroup,

  ComboboxInput,

  ComboboxItem,

  ComboboxItemIndicator,

  ComboboxLabel,

  ComboboxPortal,

  ComboboxRoot,

  ComboboxTrigger,

  ComboboxViewport,

  ComboboxVirtualizer,

  useFilter,

} from './reka'



const model = defineModel<string | string[]>({ default: '' })



const props = withDefaults(

  defineProps<{

    options: RsSelectOptions

    placeholder?: string

    disabled?: boolean

    id?: string

    /** 下拉内搜索过滤 */

    searchable?: boolean

    /**
     * 允许把搜索框内容作为自定义值提交（Enter 或点「使用 xxx」）。
     * 专业工具常见：类型名 / 枚举等不在预设列表时仍可手输。
     * 开启后若未显式关 searchable，将自动启用搜索框。
     */
    creatable?: boolean

    /** 多选，v-model 为 string[] */

    multiple?: boolean
    required?: boolean

    /** 显示清空按钮 */

    clearable?: boolean

    /** 启用虚拟滚动（长列表） */

    virtual?: boolean

    /** 超过该数量自动启用虚拟滚动 */

    virtualThreshold?: number

    /** 远程搜索：关闭内置过滤，通过 @search 拉取 options */

    remote?: boolean

    /** 远程加载中 */

    loading?: boolean

    searchPlaceholder?: string

    emptyText?: string

    loadingText?: string

    size?: RsComponentSize

    /** 圆角档位；默认 sm。直角 UI 传 `none`。 */

    radius?: RsRadius

    /**
     * 下拉面板是否与触发器等宽。
     *
     * - 默认 `false`：面板 `min-width` 对齐触发器，可随选项文案变宽（受 max-width 限制），避免长文案大量省略。
     * - `true`：面板强制与触发器同宽，适合表单栅格、筛选条等需要对齐的场景；长文案仍会 ellipsis。
     *
     * 注意：开启虚拟滚动时，列表项多为绝对定位，无法可靠把面板撑到「全局最长文案」宽度，
     * 宽度可能随可见项变化或退回到触发器宽度；长列表若强依赖内容撑宽，请关闭 virtual，
     * 或改用 `matchTriggerWidth` + 截断项 Tooltip。
     */
    matchTriggerWidth?: boolean

    /** 根节点占满父级宽度（与按钮并排时用）。 */
    block?: boolean

  }>(),

  {

    disabled: false,

    searchable: false,

    creatable: false,

    multiple: false,
    required: false,

    clearable: false,

    virtual: false,

    virtualThreshold: 50,

    remote: false,

    loading: false,

    matchTriggerWidth: false,

    block: false,

  },

)



const emit = defineEmits<{

  search: [query: string]

}>()



const { t } = useRsI18n()
const formContext = useRsFormContext()

const { contains } = useFilter({ sensitivity: 'base' })



const searchQuery = ref('')

/** 下拉显隐；支持 v-model:open（如表格多选关闭时提交） */
const open = defineModel<boolean>('open', { default: false })



const resolvedPlaceholder = computed(() => props.placeholder ?? t('select.placeholder'))

const resolvedSearchPlaceholder = computed(

  () => props.searchPlaceholder ?? t('select.searchPlaceholder'),

)

const resolvedEmptyText = computed(() => props.emptyText ?? t('select.empty'))

const resolvedLoadingText = computed(() => props.loadingText ?? t('select.loading'))

/** creatable 默认带搜索框，便于手输 */
const isSearchable = computed(() => props.searchable || props.creatable)



const labelMap = computed(() => buildOptionLabelMap(props.options))

const disabledMap = computed(() => buildOptionDisabledMap(props.options))

const flatOptions = computed(() => flattenSelectOptions(props.options))

const flatCount = computed(() => flatOptions.value.length)



const useVirtual = computed(

  () => props.virtual || flatCount.value > props.virtualThreshold,

)

const useManualFilter = computed(() => props.remote || useVirtual.value)


const displayOptions = computed(() => {
  if (props.remote) return props.options
  if (!useManualFilter.value) return props.options
  return filterSelectOptions(props.options, searchQuery.value, contains)
})

const createValue = computed(() => searchQuery.value.trim())

const canCreate = computed(() => {
  if (!props.creatable) return false
  const q = createValue.value
  if (!q) return false
  const lower = q.toLowerCase()
  return !flatOptions.value.some(
    (opt) => opt.value.toLowerCase() === lower || String(opt.label).toLowerCase() === lower,
  )
})

const createOptionLabel = computed(() =>
  t('select.createOption', '使用 “{query}”').replace('{query}', createValue.value),
)

const virtualValues = computed(() => {
  const values = flattenSelectValues(displayOptions.value)
  if (!canCreate.value) return values
  return [createValue.value, ...values.filter((v) => String(v) !== createValue.value)]
})



const selectedValues = computed<string[]>(() => {

  if (props.multiple) {

    const value = model.value

    if (Array.isArray(value)) return value.map(String)

    return value ? [String(value)] : []

  }

  const value = model.value

  return value !== '' && value !== undefined && value !== null ? [String(value)] : []

})



const hasValue = computed(() => selectedValues.value.length > 0)
const resolvedDisabled = computed(() => props.disabled || formContext?.disabled.value || false)
const resolvedSize = useResolvedRsComponentSize(() => props.size)
const resolvedRadius = useResolvedRsRadius(() => props.radius, 'sm')
const triggerIconSize = computed(() => RS_COMPONENT_SIZE_ICON_PX[resolvedSize.value])
const rootStyle = computed(() => ({
  '--rs-select-radius': rsRadiusCss(resolvedRadius.value),
}))



const singleDisplayLabel = computed(() => {

  if (props.multiple || !hasValue.value) return ''

  return labelMap.value.get(selectedValues.value[0]!) ?? selectedValues.value[0]!

})



const comboboxModel = computed<string | string[] | undefined>({

  get() {

    if (props.multiple) return selectedValues.value

    return hasValue.value ? selectedValues.value[0] : undefined

  },

  set(value) {

    if (props.multiple) {

      model.value = Array.isArray(value) ? value.map(String) : []

    } else {

      model.value = value == null || value === '' ? '' : String(value)

    }

  },

})



watch(searchQuery, (query) => {

  if (props.remote) emit('search', query)

})



watch(open, (isOpen) => {
  if (isOpen) searchQuery.value = ''
})

function commitCreatedValue(value: string): void {
  const next = value.trim()
  if (!next) return
  if (props.multiple) {
    const current = selectedValues.value
    model.value = current.includes(next) ? current : [...current, next]
  } else {
    model.value = next
    open.value = false
  }
  searchQuery.value = ''
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return
  if (!canCreate.value) return
  // 无精确匹配时 Enter 提交手输值；有匹配时交给 Combobox 默认选中行为
  event.preventDefault()
  event.stopPropagation()
  commitCreatedValue(createValue.value)
}



function onClear(event: MouseEvent) {

  event.preventDefault()

  event.stopPropagation()

  model.value = props.multiple ? [] : ''

}



function removeTag(value: string, event: MouseEvent) {

  event.preventDefault()

  event.stopPropagation()

  if (!props.multiple) return

  model.value = selectedValues.value.filter((item) => item !== value)

}

function setValue(value: unknown): void {
  if (props.multiple) {
    if (Array.isArray(value)) {
      model.value = value.map(String)
    } else if (value) {
      model.value = [String(value)]
    } else {
      model.value = []
    }
    return
  }
  model.value = value == null ? '' : String(value)
}

function clearValidation(): void {
  searchQuery.value = ''
}

useRsFormField(() => ({
  getValue: () => model.value,
  setValue,
  validate: () => ({ valid: props.multiple ? selectedValues.value.length > 0 || !props.required : Boolean(model.value) || !props.required }),
  clearValidation,
}))

defineExpose({
  setValue,
  clearValidation,
})

</script>



<template>

  <ComboboxRoot

    v-model="comboboxModel"

    v-model:open="open"

    class="rs-select"

    :class="{

      'rs-select--multiple': multiple,

      'rs-select--searchable': isSearchable,
      'rs-select--creatable': creatable,

      'rs-select--block': block,

      [`rs-select--${resolvedSize}`]: true,

    }"

    :style="rootStyle"

    :multiple="multiple"

    :disabled="resolvedDisabled"

    :ignore-filter="useManualFilter"

    :reset-search-term-on-select="!multiple"

    open-on-click

  >

    <ComboboxAnchor as-child>

      <ComboboxTrigger :id="id" class="rs-select__trigger">

        <span v-if="multiple" class="rs-select__value rs-select__value--multiple">

          <template v-if="hasValue">

            <span

              v-for="value in selectedValues"

              :key="value"

              class="rs-select__tag"

            >

              <span class="rs-select__tag-label">{{ labelMap.get(value) ?? value }}</span>

              <button

                type="button"

                class="rs-select__tag-remove"

                :aria-label="t('select.clear')"

                @pointerdown.stop

                @click="removeTag(value, $event)"

              >

                <RsIcon name="x" :size="12" />

              </button>

            </span>

          </template>

          <span v-else class="rs-select__placeholder">{{ resolvedPlaceholder }}</span>

        </span>

        <span v-else class="rs-select__value">

          <span v-if="hasValue" class="rs-select__single-label">{{ singleDisplayLabel }}</span>

          <span v-else class="rs-select__placeholder">{{ resolvedPlaceholder }}</span>

        </span>



        <span class="rs-select__actions">

          <button

            v-if="clearable && hasValue && !resolvedDisabled"

            type="button"

            class="rs-select__clear"

            :aria-label="t('select.clear')"

            @pointerdown.stop

            @click="onClear"

          >

            <RsIcon name="x" :size="14" />

          </button>

          <RsIcon name="chevron-down" :size="triggerIconSize" class="rs-select__icon" />

        </span>

      </ComboboxTrigger>

    </ComboboxAnchor>



    <ComboboxPortal>

      <ComboboxContent
        class="rs-select__content"
        :class="{ 'rs-select__content--match-trigger': matchTriggerWidth }"
        align="start"
        :side-offset="4"
        position="popper"
      >

        <div v-if="isSearchable" class="rs-select__search-bar">
          <div class="rs-select__search-wrap">
            <RsIcon name="search" :size="14" class="rs-select__search-icon" aria-hidden="true" />
            <ComboboxInput
              v-model="searchQuery"
              class="rs-select__search"
              :placeholder="resolvedSearchPlaceholder"
              auto-focus
              @keydown="onSearchKeydown"
            />
          </div>
        </div>



        <div v-if="loading" class="rs-select__status">{{ resolvedLoadingText }}</div>



        <ComboboxEmpty v-if="!loading && !canCreate" class="rs-select__empty">

          {{ resolvedEmptyText }}

        </ComboboxEmpty>



        <ComboboxViewport class="rs-select__viewport">

          <ComboboxVirtualizer

            v-if="useVirtual"

            v-slot="{ option }"

            :options="virtualValues"

            :text-content="(value) => labelMap.get(String(value)) ?? String(value)"

            :estimate-size="36"

          >

            <ComboboxItem
              :value="option"
              :disabled="disabledMap.get(String(option))"
              :text-value="labelMap.get(String(option)) ?? String(option)"
              class="rs-select__item"
              :class="{ 'rs-select__item--create': canCreate && String(option) === createValue }"
            >
              <span class="rs-select__item-label">
                {{
                  canCreate && String(option) === createValue
                    ? createOptionLabel
                    : (labelMap.get(String(option)) ?? option)
                }}
              </span>
              <ComboboxItemIndicator class="rs-select__item-check">
                <RsIcon name="check" :size="14" />
              </ComboboxItemIndicator>
            </ComboboxItem>

          </ComboboxVirtualizer>



          <template v-else>

            <ComboboxItem
              v-if="canCreate"
              :value="createValue"
              :text-value="createValue"
              class="rs-select__item rs-select__item--create"
            >
              <span class="rs-select__item-label">{{ createOptionLabel }}</span>
              <ComboboxItemIndicator class="rs-select__item-check">
                <RsIcon name="check" :size="14" />
              </ComboboxItemIndicator>
            </ComboboxItem>

            <template v-for="(entry, index) in displayOptions" :key="index">

              <ComboboxGroup v-if="isSelectOptionGroup(entry)" class="rs-select__group">

                <ComboboxLabel class="rs-select__group-label">

                  {{ entry.label }}

                </ComboboxLabel>

                <ComboboxItem
                  v-for="opt in entry.options"
                  :key="opt.value"
                  :value="opt.value"
                  :disabled="opt.disabled"
                  :text-value="opt.label"
                  class="rs-select__item"
                >
                  <span class="rs-select__item-label">{{ opt.label }}</span>
                  <ComboboxItemIndicator class="rs-select__item-check">
                    <RsIcon name="check" :size="14" />
                  </ComboboxItemIndicator>
                </ComboboxItem>

              </ComboboxGroup>



              <ComboboxItem
                v-else
                :key="entry.value"
                :value="entry.value"
                :disabled="entry.disabled"
                :text-value="entry.label"
                class="rs-select__item"
              >
                <span class="rs-select__item-label">{{ entry.label }}</span>
                <ComboboxItemIndicator class="rs-select__item-check">
                  <RsIcon name="check" :size="14" />
                </ComboboxItemIndicator>
              </ComboboxItem>

            </template>

          </template>

        </ComboboxViewport>

      </ComboboxContent>

    </ComboboxPortal>

  </ComboboxRoot>

</template>



<style scoped>

.rs-select {

  display: inline-flex;

  width: 100%;

  max-width: 20rem;

}

.rs-select__trigger {

  display: inline-flex;

  align-items: center;

  justify-content: space-between;

  gap: var(--rs-space-sm);

  width: 100%;

  min-height: var(--rs-control-height-md);

  padding: 0 var(--rs-space-md);

  border-radius: var(--rs-select-radius, var(--rs-radius-sm));

  border: 1px solid var(--rs-input-border, var(--rs-border));

  background: var(--rs-input-bg);

  color: var(--rs-text);

  font-size: var(--rs-font-size-sm);

  line-height: var(--rs-line-height-normal);

  text-align: left;

  cursor: pointer;

  box-shadow: var(--rs-input-shadow, none);

  transition:

    border-color var(--rs-transition-fast),

    box-shadow var(--rs-transition-fast),

    background var(--rs-transition-fast);

}

.rs-select--multiple .rs-select__trigger {

  min-height: var(--rs-control-height-md);

  height: auto;

  padding-top: var(--rs-space-xs);

  padding-bottom: var(--rs-space-xs);

}

.rs-select--block {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.rs-select--block .rs-select__anchor,
.rs-select--block .rs-select__trigger {
  width: 100%;
}

.rs-select--ssm .rs-select__trigger {
  min-height: var(--rs-control-height-ssm);
  padding: 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
}

.rs-select--ssm.rs-select--multiple .rs-select__trigger {
  min-height: var(--rs-control-height-ssm);
}

.rs-select--sm .rs-select__trigger {
  min-height: var(--rs-control-height-sm);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
}

.rs-select--sm.rs-select--multiple .rs-select__trigger {
  min-height: var(--rs-control-height-sm);
}

.rs-select--lg .rs-select__trigger {
  min-height: var(--rs-control-height-lg);
  padding: 0 var(--rs-space-lg);
  font-size: var(--rs-font-size-base);
}

.rs-select--lg.rs-select--multiple .rs-select__trigger {
  min-height: var(--rs-control-height-lg);
}

.rs-select__trigger:hover:not([data-disabled]) {

  border-color: var(--rs-input-border-hover, var(--rs-border));

}

.rs-select__trigger:focus-visible {

  outline: none;

  border-color: var(--rs-focus-border, var(--rs-primary));

  background: var(--rs-input-bg);

  box-shadow:

    var(--rs-input-shadow, none),

    0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);

}

.rs-select__trigger[data-disabled] {

  opacity: 0.38;

  cursor: not-allowed;

  background: var(--rs-surface-hover);

}

.rs-select__value {

  flex: 1;

  min-width: 0;

  text-align: left;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;

}

.rs-select__value--multiple {

  display: flex;

  flex-wrap: nowrap;

  gap: var(--rs-space-xs);

  align-items: center;

  white-space: nowrap;

  overflow: hidden;

}

.rs-select__placeholder {

  color: var(--rs-placeholder);

}

.rs-select__single-label {

  display: block;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;

}

.rs-select__tag {

  display: inline-flex;

  align-items: center;

  gap: 0.125rem;

  flex: 0 0 auto;

  max-width: 10rem;

  padding: 0.125rem 0.25rem 0.125rem 0.5rem;

  border-radius: var(--rs-radius-xs);

  border: 1px solid color-mix(in srgb, var(--rs-primary) 24%, transparent);

  background: var(--rs-primary-container);

  color: var(--rs-on-primary-container);

  font-size: var(--rs-font-size-xs);

  line-height: var(--rs-line-height-tight);

}

.rs-select__tag-label {

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;

}

.rs-select__tag-remove {

  display: inline-flex;

  align-items: center;

  justify-content: center;

  width: 1rem;

  height: 1rem;

  padding: 0;

  border: none;

  border-radius: var(--rs-radius-xs);

  background: transparent;

  color: var(--rs-muted);

  cursor: pointer;

  transition:

    color var(--rs-transition-fast),

    background var(--rs-transition-fast);

}

.rs-select__tag-remove:hover {

  color: var(--rs-on-primary-container);

  background: color-mix(in srgb, var(--rs-primary) 16%, transparent);

}

.rs-select__actions {

  display: inline-flex;

  align-items: center;

  gap: var(--rs-space-xs);

  flex-shrink: 0;

}

.rs-select__clear {

  display: inline-flex;

  align-items: center;

  justify-content: center;

  width: 1.25rem;

  height: 1.25rem;

  padding: 0;

  border: none;

  border-radius: var(--rs-radius-xs);

  background: transparent;

  color: var(--rs-muted);

  cursor: pointer;

  transition:

    color var(--rs-transition-fast),

    background var(--rs-transition-fast);

}

.rs-select__clear:hover {

  color: var(--rs-text);

  background: var(--rs-item-hover);

}

.rs-select__icon {

  color: var(--rs-muted);

  flex-shrink: 0;

  transition: transform var(--rs-transition-fast);

}

.rs-select__trigger[data-state='open'] .rs-select__icon {

  transform: rotate(180deg);

}

.rs-select__item--create .rs-select__item-label {
  color: var(--rs-primary);
  font-weight: 500;
}

</style>


