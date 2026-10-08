<script setup lang="ts">
import { RsButton } from '@niuma/ui'

defineProps<{
  canSend: boolean
  error: string
}>()

const body = defineModel<string>({ required: true })
const kind = defineModel<'text' | 'json' | 'base64'>('kind', { required: true })

const emit = defineEmits<{
  send: []
  keydown: [event: KeyboardEvent]
}>()
</script>

<template>
  <section class="nm-api-ws__compose">
    <div class="nm-api-ws__bar">
      <span>{{ $t('modules.api.wsMessage') }}</span>
      <div class="nm-api-ws__pills">
        <button
          v-for="item in (['text', 'json', 'base64'] as const)"
          :key="item"
          type="button"
          class="nm-api-ws__pill"
          :class="{ 'nm-api-ws__pill--on': kind === item }"
          @click="kind = item"
        >
          {{ item === 'text' ? 'Text' : item === 'json' ? 'JSON' : 'Base64' }}
        </button>
      </div>
      <RsButton variant="primary" size="sm" :disabled="!canSend" @click="emit('send')">
        {{ $t('modules.api.send') }}
      </RsButton>
    </div>
    <textarea
      v-model="body"
      class="nm-api-ws__input"
      spellcheck="false"
      :placeholder="$t('modules.api.wsMessageHint')"
      @keydown="emit('keydown', $event)"
    />
    <p v-if="error" class="nm-api-ws__error">{{ error }}</p>
  </section>
</template>
