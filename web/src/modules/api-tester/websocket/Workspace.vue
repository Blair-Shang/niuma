<script setup lang="ts">
/**
 * WebSocket 工作台占位。协议已登记，发送链 P3 再接。
 */
import { RsEmpty } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'

defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="nm-api-ws-stub">
    <RsEmpty fill :description="t('modules.api.wsUnsupported')" />
  </div>
</template>

<style scoped>
.nm-api-ws-stub {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}
</style>
