<script setup lang="ts">
import { RsButton, RsDialog } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  useSqliteMaintainExec,
  type SqliteMaintainCheckSummary,
} from '@/modules/sqlite/composables/useSqliteMaintainExec'
import { useSqliteMaintainActionStore } from '@/modules/sqlite/stores/maintain-actions'

const { t } = useI18n()
const store = useSqliteMaintainActionStore()
const { pending, busy } = storeToRefs(store)
const { runCheck } = useSqliteMaintainExec()

const error = ref('')
const summary = ref<SqliteMaintainCheckSummary | null>(null)

const open = computed({
  get: () => pending.value?.kind === 'check',
  set: (v: boolean) => {
    if (!v && !busy.value) store.clear()
  },
})

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

async function load(): Promise<void> {
  if (!pending.value || pending.value.kind !== 'check') return
  error.value = ''
  summary.value = null
  try {
    summary.value = await runCheck()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.sqlite.maintain.execError')
  }
}

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'check') void load()
  },
  { immediate: true },
)
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="md"
    layout="window"
    tone="default"
    :modal="false"
    :draggable="true"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <p v-if="description" class="nm-sqlite-check__desc">{{ description }}</p>

      <div v-if="busy" class="nm-sqlite-check__status">
        {{ t('modules.sqlite.maintain.checking') }}
      </div>
      <div v-else-if="error" class="nm-sqlite-check__status nm-sqlite-check__status--error">
        {{ error }}
      </div>
      <div v-else-if="summary" class="nm-sqlite-check">
        <div
          class="nm-sqlite-check__banner"
          :class="
            summary.ok
              ? 'nm-sqlite-check__banner--ok'
              : 'nm-sqlite-check__banner--fail'
          "
        >
          {{
            summary.ok
              ? t('modules.sqlite.maintain.checkPass')
              : t('modules.sqlite.maintain.checkFail')
          }}
          <span class="nm-sqlite-check__meta">
            {{ t('modules.sqlite.maintain.checkMeta', { ms: summary.durationMs }) }}
          </span>
        </div>

        <p v-if="summary.truncated" class="nm-sqlite-check__warn">
          {{ t('modules.sqlite.maintain.checkTruncated') }}
        </p>

        <ul v-if="!summary.ok" class="nm-sqlite-check__list">
          <li v-for="(msg, i) in summary.messages" :key="i">{{ msg }}</li>
        </ul>
        <p v-else class="nm-sqlite-check__ok-detail">
          {{ summary.messages[0] || 'ok' }}
        </p>
      </div>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="void load()">
        {{ t('modules.sqlite.maintain.recheck') }}
      </RsButton>
      <RsButton variant="primary" :disabled="busy" @click="store.clear()">
        {{ t('common.close') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped>
.nm-sqlite-check__desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--rs-fg-muted, #6b7280);
  line-height: 1.4;
}

.nm-sqlite-check__status {
  font-size: 13px;
  color: var(--rs-fg-muted, #6b7280);
  padding: 8px 0;
}

.nm-sqlite-check__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-sqlite-check__banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  padding: 10px 12px;
  border-radius: var(--rs-radius-sm, 6px);
  font-size: 14px;
  font-weight: 600;
}

.nm-sqlite-check__banner--ok {
  background: color-mix(in srgb, var(--rs-success, #16a34a) 12%, transparent);
  color: var(--rs-success, #15803d);
}

.nm-sqlite-check__banner--fail {
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 12%, transparent);
  color: var(--rs-danger, #b91c1c);
}

.nm-sqlite-check__meta {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.85;
}

.nm-sqlite-check__warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--rs-warning, #b45309);
}

.nm-sqlite-check__list {
  margin: 12px 0 0;
  padding-left: 1.2rem;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.45;
  color: var(--rs-fg, #111827);
}

.nm-sqlite-check__ok-detail {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--rs-fg-muted, #6b7280);
}
</style>
