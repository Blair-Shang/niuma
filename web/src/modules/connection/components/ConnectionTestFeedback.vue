<script setup lang="ts">
import type { ConnectionTestMessage } from '@/modules/connection/types'

defineProps<{
  message: ConnectionTestMessage | null
}>()
</script>

<template>
  <p
    v-if="message"
    class="nm-conn-test"
    :class="{ 'nm-conn-test--ok': message.ok }"
    role="status"
    aria-live="polite"
  >
    {{ message.text }}
  </p>
</template>

<style scoped>
.nm-conn-test {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
}

.nm-conn-test--ok {
  color: var(--rs-success);
}
</style>
