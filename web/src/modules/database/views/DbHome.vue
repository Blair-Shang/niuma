<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="nm-module-root nm-module-empty">
    <h2 class="nm-section-title">{{ t('modules.database.title') }}</h2>
    <p class="nm-section-desc">{{ t('modules.database.desc') }}</p>
  </div>
</template>
