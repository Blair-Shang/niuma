<script setup lang="ts">
import { RsLabel } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { CONN_ACCENT_COLORS, type ConnAccentColor } from '@/modules/ops/types'

const model = defineModel<ConnAccentColor>({ required: true })

const { t } = useI18n()
</script>

<template>
  <div class="nm-conn-colors">
    <RsLabel class="nm-conn-colors__label">{{ t('opsNav.form.color') }}</RsLabel>
    <div class="nm-conn-colors__group" role="radiogroup" :aria-label="t('opsNav.form.color')">
      <label
        v-for="color in CONN_ACCENT_COLORS"
        :key="color"
        class="nm-conn-colors__item"
        :title="color"
      >
        <input
          v-model="model"
          type="radio"
          class="nm-conn-colors__input"
          name="conn-accent-color"
          :value="color"
          :aria-label="color"
        >
        <span
          class="nm-conn-colors__swatch"
          :class="{ 'nm-conn-colors__swatch--active': model === color }"
          :style="{ '--nm-swatch': color }"
          aria-hidden="true"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.nm-conn-colors {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-conn-colors__label {
  margin: 0;
}

.nm-conn-colors__group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.nm-conn-colors__item {
  display: inline-flex;
  cursor: pointer;
}

.nm-conn-colors__input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.nm-conn-colors__swatch {
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--nm-swatch);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
}

.nm-conn-colors__input:checked + .nm-conn-colors__swatch,
.nm-conn-colors__swatch--active {
  border-color: var(--rs-text);
  box-shadow:
    0 0 0 1px var(--rs-surface-elevated),
    0 0 0 2.5px var(--nm-swatch);
}

.nm-conn-colors__input:focus-visible + .nm-conn-colors__swatch {
  outline: 2px solid var(--rs-focus-ring);
  outline-offset: 2px;
}
</style>
