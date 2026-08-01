<script setup lang="ts">
import { RsButton, RsDialog } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sqliteApi } from '@/api/sqlite'
import type { SqliteMetaDatabaseInfoResult } from '@/api/types/sqlite'
import { useSqliteDbPropertiesStore } from '@/modules/sqlite/stores/db-properties'

const { t } = useI18n()
const store = useSqliteDbPropertiesStore()
const { pending } = storeToRefs(store)

const busy = ref(false)
const error = ref('')
const info = ref<SqliteMetaDatabaseInfoResult | null>(null)

const open = computed({
  get: () => pending.value !== null,
  set: (v: boolean) => {
    if (!v && !busy.value) store.clear()
  },
})

const title = computed(
  () => pending.value?.title || t('modules.sqlite.properties.title'),
)

function formatBytes(pages: number | undefined, pageSize: number | undefined): string {
  if (!pages || !pageSize) return '—'
  const bytes = pages * pageSize
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function load(): Promise<void> {
  const req = pending.value
  if (!req) return
  busy.value = true
  error.value = ''
  info.value = null
  try {
    info.value = await sqliteApi.metaDatabaseInfo(
      req.sessionId
        ? { sessionId: req.sessionId }
        : { profileId: req.profileId },
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.sqlite.properties.loadError')
  } finally {
    busy.value = false
  }
}

watch(
  () => pending.value,
  (req) => {
    if (req) void load()
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
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="true"
  >
    <template #body>
      <div v-if="busy" class="nm-sqlite-props__status">
        {{ t('modules.sqlite.properties.loading') }}
      </div>
      <div v-else-if="error" class="nm-sqlite-props__status nm-sqlite-props__status--error">
        {{ error }}
      </div>
      <div v-else-if="info" class="nm-sqlite-props">
        <dl class="nm-sqlite-props__grid">
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.version') }}</dt>
            <dd>{{ info.version || '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.encoding') }}</dt>
            <dd>{{ info.encoding || '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.journalMode') }}</dt>
            <dd>{{ info.journalMode || '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.synchronous') }}</dt>
            <dd>{{ info.synchronous || '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.autoVacuum') }}</dt>
            <dd>{{ info.autoVacuum || '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.foreignKeys') }}</dt>
            <dd>
              {{
                info.foreignKeys
                  ? t('modules.sqlite.properties.on')
                  : t('modules.sqlite.properties.off')
              }}
            </dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.pageSize') }}</dt>
            <dd>{{ info.pageSize ?? '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.pageCount') }}</dt>
            <dd>{{ info.pageCount ?? '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.freelist') }}</dt>
            <dd>{{ info.freelistCount ?? '—' }}</dd>
          </div>
          <div class="nm-sqlite-props__row">
            <dt>{{ t('modules.sqlite.properties.approxSize') }}</dt>
            <dd>{{ formatBytes(info.pageCount, info.pageSize) }}</dd>
          </div>
        </dl>

        <h3 class="nm-sqlite-props__section">
          {{ t('modules.sqlite.properties.attached') }}
        </h3>
        <table v-if="info.databases?.length" class="nm-sqlite-props__table">
          <thead>
            <tr>
              <th>{{ t('modules.sqlite.properties.alias') }}</th>
              <th>{{ t('modules.sqlite.properties.file') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="db in info.databases" :key="`${db.seq}-${db.name}`">
              <td>{{ db.name }}</td>
              <td class="nm-sqlite-props__file">{{ db.file || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="nm-sqlite-props__status">
          {{ t('modules.sqlite.properties.noAttached') }}
        </p>
      </div>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="void load()">
        {{ t('modules.sqlite.properties.reload') }}
      </RsButton>
      <RsButton variant="primary" :disabled="busy" @click="store.clear()">
        {{ t('common.close') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped>
.nm-sqlite-props__status {
  font-size: 13px;
  color: var(--rs-fg-muted, #6b7280);
  padding: 8px 0;
}

.nm-sqlite-props__status--error {
  color: var(--rs-danger, #dc2626);
}

.nm-sqlite-props__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
  margin: 0;
}

.nm-sqlite-props__row {
  display: grid;
  gap: 2px;
}

.nm-sqlite-props__row dt {
  font-size: 11px;
  color: var(--rs-fg-muted, #6b7280);
}

.nm-sqlite-props__row dd {
  margin: 0;
  font-size: 13px;
  word-break: break-all;
}

.nm-sqlite-props__section {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.nm-sqlite-props__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.nm-sqlite-props__table th,
.nm-sqlite-props__table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--rs-border-subtle, #e5e7eb);
  vertical-align: top;
}

.nm-sqlite-props__file {
  word-break: break-all;
  color: var(--rs-fg-muted, #6b7280);
}

@media (max-width: 560px) {
  .nm-sqlite-props__grid {
    grid-template-columns: 1fr;
  }
}
</style>
