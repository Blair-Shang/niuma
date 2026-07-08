<script setup lang="ts">

import { computed, ref, watch } from 'vue'

import { useRsI18n } from '../composables/useRsI18n'
import type { RsComponentSize } from '../theme/types'

import RsIcon from './RsIcon.vue'
import { useRsFormContext, useRsFormField } from './form-utils'

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

  }>(),

  {

    disabled: false,

    searchable: false,

    multiple: false,
    required: false,

    clearable: false,

    virtual: false,

    virtualThreshold: 50,

    remote: false,

    loading: false,

  },

)



const emit = defineEmits<{

  search: [query: string]

}>()



const { t } = useRsI18n()
const formContext = useRsFormContext()

const { contains } = useFilter({ sensitivity: 'base' })



const searchQuery = ref('')

const open = ref(false)



const resolvedPlaceholder = computed(() => props.placeholder ?? t('select.placeholder'))

const resolvedSearchPlaceholder = computed(

  () => props.searchPlaceholder ?? t('select.searchPlaceholder'),

)

const resolvedEmptyText = computed(() => props.emptyText ?? t('select.empty'))

const resolvedLoadingText = computed(() => props.loadingText ?? t('select.loading'))



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



const virtualValues = computed(() => flattenSelectValues(displayOptions.value))



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
const resolvedSize = computed(() => props.size ?? formContext?.size.value ?? 'md')
const triggerIconSize = computed(() => {
  const sizeMap: Record<RsComponentSize, number> = { sm: 14, md: 16, lg: 18 }
  return sizeMap[resolvedSize.value]
})



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

  if (!isOpen) searchQuery.value = ''

})



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

      'rs-select--searchable': searchable,

      [`rs-select--${resolvedSize}`]: true,

    }"

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
        align="start"
        :side-offset="4"
        position="popper"
      >

        <div v-if="searchable" class="rs-select__search-bar">
          <div class="rs-select__search-wrap">
            <RsIcon name="search" :size="14" class="rs-select__search-icon" aria-hidden="true" />
            <ComboboxInput
              v-model="searchQuery"
              class="rs-select__search"
              :placeholder="resolvedSearchPlaceholder"
              auto-focus
            />
          </div>
        </div>



        <div v-if="loading" class="rs-select__status">{{ resolvedLoadingText }}</div>



        <ComboboxEmpty v-if="!loading" class="rs-select__empty">

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
              :text-value="labelMap.get(String(option))"
              class="rs-select__item"
            >
              <span class="rs-select__item-label">{{ labelMap.get(String(option)) ?? option }}</span>
              <ComboboxItemIndicator class="rs-select__item-check">
                <RsIcon name="check" :size="14" />
              </ComboboxItemIndicator>
            </ComboboxItem>

          </ComboboxVirtualizer>



          <template v-else>

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

  border-radius: var(--rs-radius-sm);

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

  flex-wrap: wrap;

  gap: var(--rs-space-xs);

  align-items: center;

  white-space: normal;

  overflow: visible;

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

  max-width: 100%;

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

</style>


