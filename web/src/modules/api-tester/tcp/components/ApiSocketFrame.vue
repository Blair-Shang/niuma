<script setup lang="ts">
/**
 * TCP 切帧。模式在状态行右侧；选中分隔符或长度后，参数独占下一行。
 */
import { computed } from 'vue'
import { RsInput, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import {
  modbusLengthFields,
  sameLengthFields,
  u16beLengthFields,
  type SocketFrameDelimiter,
  type SocketFrameMode,
  type SocketLengthEndian,
  type SocketLengthSize,
} from '../utils/frame'

const props = defineProps<{
  locked: boolean
}>()

const mode = defineModel<SocketFrameMode>('mode', { required: true })
const delimiter = defineModel<SocketFrameDelimiter>('delimiter', { required: true })
const lengthOffset = defineModel<number>('lengthOffset', { required: true })
const lengthSize = defineModel<SocketLengthSize>('lengthSize', { required: true })
const lengthEndian = defineModel<SocketLengthEndian>('lengthEndian', { required: true })
const lengthAdjust = defineModel<number>('lengthAdjust', { required: true })

const { t } = useI18n()

const modes: { id: SocketFrameMode; labelKey: string }[] = [
  { id: 'raw', labelKey: 'modules.api.socketFrameRaw' },
  { id: 'delimiter', labelKey: 'modules.api.socketFrameDelimiter' },
  { id: 'length', labelKey: 'modules.api.socketFrameLength' },
]

const delimiters: { id: SocketFrameDelimiter; labelKey: string }[] = [
  { id: 'lf', labelKey: 'modules.api.socketLineLf' },
  { id: 'cr', labelKey: 'modules.api.socketLineCr' },
  { id: 'crlf', labelKey: 'modules.api.socketLineCrlf' },
]

const sizes: SocketLengthSize[] = [1, 2, 4]

const lengthNow = computed(() => ({
  lengthOffset: lengthOffset.value,
  lengthSize: lengthSize.value,
  lengthEndian: lengthEndian.value,
  lengthAdjust: lengthAdjust.value,
}))

const offsetText = computed({
  get: () => String(lengthOffset.value),
  set: (value: string) => {
    const n = Number(value)
    if (Number.isFinite(n)) lengthOffset.value = n
  },
})

const adjustText = computed({
  get: () => String(lengthAdjust.value),
  set: (value: string) => {
    const n = Number(value)
    if (Number.isFinite(n)) lengthAdjust.value = n
  },
})

function applyLength(fields: ReturnType<typeof modbusLengthFields>): void {
  lengthOffset.value = fields.lengthOffset
  lengthSize.value = fields.lengthSize
  lengthEndian.value = fields.lengthEndian
  lengthAdjust.value = fields.lengthAdjust
}
</script>

<template>
  <div class="nm-api-sock__frame-opt">
    <span class="nm-api-sock__group-label">{{ t('modules.api.socketFrame') }}</span>
    <RsTooltip icon side="bottom" align="start" :aria-label="t('modules.api.socketFrame')">
      <template #content>
        <div class="nm-api-sock__frame-tip">
          <div class="nm-api-sock__frame-tip-lead">{{ t('modules.api.socketFrameTipLead') }}</div>
          <div class="nm-api-sock__frame-tip-rules">
            <div><b>{{ t('modules.api.socketFrameRaw') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameRawTip') }}</div>
            <div><b>{{ t('modules.api.socketFrameDelimiter') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameDelimiterTip') }}</div>
            <div><b>{{ t('modules.api.socketFrameLength') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameLengthTip') }}</div>
          </div>
          <div class="nm-api-sock__frame-tip-note">{{ t('modules.api.socketFrameWhen') }}</div>
          <div v-if="props.locked" class="nm-api-sock__frame-tip-note">{{ t('modules.api.socketFrameLocked') }}</div>
        </div>
      </template>
    </RsTooltip>
    <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm" :disabled="locked">
      <legend class="nm-api-sock__sr">{{ t('modules.api.socketFrame') }}</legend>
      <button
        v-for="item in modes"
        :key="item.id"
        type="button"
        class="nm-api-sock__pill"
        :class="{ 'nm-api-sock__pill--on': mode === item.id }"
        :disabled="locked"
        @click="mode = item.id"
      >
        {{ t(item.labelKey) }}
      </button>
    </fieldset>
  </div>

  <div v-if="mode === 'delimiter'" class="nm-api-sock__frame-set">
    <span class="nm-api-sock__group-label">{{ t('modules.api.socketFrameTail') }}</span>
    <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm" :disabled="locked">
      <legend class="nm-api-sock__sr">{{ t('modules.api.socketFrameTail') }}</legend>
      <button
        v-for="item in delimiters"
        :key="item.id"
        type="button"
        class="nm-api-sock__pill"
        :class="{ 'nm-api-sock__pill--on': delimiter === item.id }"
        :disabled="locked"
        @click="delimiter = item.id"
      >
        {{ t(item.labelKey) }}
      </button>
    </fieldset>
  </div>

  <div v-else-if="mode === 'length'" class="nm-api-sock__frame-set">
    <RsTooltip icon side="bottom" align="end" :aria-label="t('modules.api.socketFrameLength')">
      <template #content>
        <div class="nm-api-sock__frame-tip">
          <div class="nm-api-sock__frame-tip-rules">
            <div><b>{{ t('modules.api.socketFrameOffset') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameOffsetTip') }}</div>
            <div><b>{{ t('modules.api.socketFrameWidth') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameWidthTip') }}</div>
            <div><b>{{ t('modules.api.socketFrameEndian') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameEndianTip') }}</div>
            <div><b>{{ t('modules.api.socketFrameAdjust') }}{{ t('modules.api.socketFrameColon') }}</b>{{ t('modules.api.socketFrameAdjustTip') }}</div>
          </div>
        </div>
      </template>
    </RsTooltip>
    <label class="nm-api-sock__frame-field">
      <span>{{ t('modules.api.socketFrameOffset') }}</span>
      <RsInput v-model="offsetText" size="sm" radius="sm" class="nm-api-sock__frame-num" inputmode="numeric" :disabled="locked" :aria-label="t('modules.api.socketFrameOffset')" />
    </label>
    <span class="nm-api-sock__group-label">{{ t('modules.api.socketFrameWidth') }}</span>
    <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm" :disabled="locked">
      <legend class="nm-api-sock__sr">{{ t('modules.api.socketFrameWidth') }}</legend>
      <button
        v-for="item in sizes"
        :key="item"
        type="button"
        class="nm-api-sock__pill"
        :class="{ 'nm-api-sock__pill--on': lengthSize === item }"
        :disabled="locked"
        @click="lengthSize = item"
      >
        {{ item }}
      </button>
    </fieldset>
    <span class="nm-api-sock__group-label">{{ t('modules.api.socketFrameEndian') }}</span>
    <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm" :disabled="locked">
      <legend class="nm-api-sock__sr">{{ t('modules.api.socketFrameEndian') }}</legend>
      <button type="button" class="nm-api-sock__pill" :class="{ 'nm-api-sock__pill--on': lengthEndian === 'big' }" :disabled="locked" @click="lengthEndian = 'big'">BE</button>
      <button type="button" class="nm-api-sock__pill" :class="{ 'nm-api-sock__pill--on': lengthEndian === 'little' }" :disabled="locked" @click="lengthEndian = 'little'">LE</button>
    </fieldset>
    <label class="nm-api-sock__frame-field">
      <span>{{ t('modules.api.socketFrameAdjust') }}</span>
      <RsInput v-model="adjustText" size="sm" radius="sm" class="nm-api-sock__frame-num" inputmode="numeric" :disabled="locked" :aria-label="t('modules.api.socketFrameAdjust')" />
    </label>
    <fieldset class="nm-api-sock__pills nm-api-sock__pills--sm" :disabled="locked">
      <legend class="nm-api-sock__sr">{{ t('modules.api.socketFrameLength') }}</legend>
      <button type="button" class="nm-api-sock__pill" :class="{ 'nm-api-sock__pill--on': sameLengthFields(lengthNow, modbusLengthFields()) }" :disabled="locked" @click="applyLength(modbusLengthFields())">
        {{ t('modules.api.socketFrameModbus') }}
      </button>
      <button type="button" class="nm-api-sock__pill" :class="{ 'nm-api-sock__pill--on': sameLengthFields(lengthNow, u16beLengthFields()) }" :disabled="locked" @click="applyLength(u16beLengthFields())">
        {{ t('modules.api.socketFrameU16') }}
      </button>
    </fieldset>
  </div>
</template>
