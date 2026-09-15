<script setup lang="ts">
/**
 * 工具确认操作：主按钮允许一次，下拉可选本轮 / 本会话同类工具不再询问。
 */
import { computed } from 'vue'
import { RsButton, RsDropdown, RsIcon, type RsDropdownItems } from '@niuma/ui'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    deciding?: boolean
  }>(),
  { deciding: false },
)

const emit = defineEmits<{
  approve: [scope: 'once' | 'run' | 'conversation']
  reject: []
}>()

const { t } = useI18n()

const moreItems = computed<RsDropdownItems>(() => [
  { value: 'run', label: t('ai.toolApproveRun') },
  { value: 'conversation', label: t('ai.toolApproveSession') },
])

function onMore(value: string): void {
  if (value === 'run' || value === 'conversation') {
    emit('approve', value)
  }
}
</script>

<template>
  <div class="nm-ai-confirm">
    <div class="nm-ai-confirm__approve">
      <RsButton
        size="sm"
        variant="primary"
        class="nm-ai-confirm__once"
        :loading="props.deciding"
        @click.stop="emit('approve', 'once')"
      >
        {{ t('ai.toolApprove') }}
      </RsButton>
      <RsDropdown
        :items="moreItems"
        :disabled="props.deciding"
        :show-selected="false"
        @select="onMore"
      >
        <template #trigger>
          <RsButton
            size="sm"
            variant="primary"
            class="nm-ai-confirm__more"
            :disabled="props.deciding"
            :aria-label="t('ai.toolApproveMore')"
            @click.stop
          >
            <RsIcon name="chevron-down" :size="12" />
          </RsButton>
        </template>
      </RsDropdown>
    </div>
    <RsButton size="sm" variant="ghost" :disabled="props.deciding" @click.stop="emit('reject')">
      {{ t('ai.toolReject') }}
    </RsButton>
  </div>
</template>

<style scoped>
.nm-ai-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.nm-ai-confirm__approve {
  display: inline-flex;
  align-items: stretch;
}

.nm-ai-confirm__approve :deep(.rs-dropdown__trigger-slot) {
  display: inline-flex;
}

.nm-ai-confirm__once {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.nm-ai-confirm__more {
  min-width: 28px;
  padding-inline: 6px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: 1px solid color-mix(in srgb, var(--rs-primary-fg, #fff) 28%, transparent);
}
</style>
