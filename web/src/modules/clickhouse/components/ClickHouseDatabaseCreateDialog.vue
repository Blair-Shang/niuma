<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClickHouseClusterOptions } from '@/modules/clickhouse/composables/useClickHouseClusterOptions'
import { useClickHouseDdlDialog } from '@/modules/clickhouse/composables/useClickHouseDdlDialog'
import { useClickHouseDdlExec } from '@/modules/clickhouse/composables/useClickHouseDdlExec'
import { CLICKHOUSE_DATABASE_ENGINES } from '@/modules/clickhouse/utils/script-templates'

const { t } = useI18n()
const { open, pending, store } = useClickHouseDdlDialog()
const { exec, busy } = useClickHouseDdlExec()
const {
  onCluster,
  supportOnCluster,
  clusterOptions,
  loading: clustersLoading,
  reload: reloadClusters,
  resolveOnCluster,
} = useClickHouseClusterOptions()

const dbName = ref('')
const engine = ref('Atomic')
const comment = ref('')

const isAlter = computed(() => pending.value?.kind === 'alter_database')
const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const confirmText = computed(() =>
  isAlter.value ? t('modules.clickhouse.ddl.confirmAlter') : t('modules.clickhouse.ddl.confirmCreate'),
)

const engineOptions = computed(() => {
  const known = new Set<string>(CLICKHOUSE_DATABASE_ENGINES)
  const cur = engine.value.trim()
  const base = CLICKHOUSE_DATABASE_ENGINES.map((value) => ({ value, label: value }))
  if (cur && !known.has(cur)) {
    return [{ value: cur, label: cur }, ...base]
  }
  return base
})

const canConfirm = computed(() => {
  const req = pending.value
  if (!req) return false
  if (req.kind === 'create_database') {
    return dbName.value.trim().length > 0
  }
  if (req.kind !== 'alter_database') return false
  const origComment = req.createOptions?.comment ?? ''
  const origCluster = req.createOptions?.onCluster?.trim() ?? ''
  const nextCluster = supportOnCluster.value ? onCluster.value.trim() : ''
  return comment.value !== origComment || nextCluster !== origCluster
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'create_database' && req?.kind !== 'alter_database') return
    dbName.value = req.name || ''
    engine.value = req.createOptions?.engine?.trim() || 'Atomic'
    comment.value = req.createOptions?.comment ?? ''
    void reloadClusters({
      profileId: req.profileId,
      preferred: req.createOptions?.onCluster,
    })
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || !canConfirm.value) return
  if (req.kind === 'create_database') {
    await exec({
      newName: dbName.value.trim(),
      createOptions: {
        onCluster: resolveOnCluster(),
        engine: engine.value.trim() || undefined,
        comment: comment.value,
      },
    })
    return
  }
  if (req.kind !== 'alter_database') return
  await exec({
    createOptions: {
      onCluster: resolveOnCluster(),
      comment: comment.value,
    },
  })
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="md"
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-clickhouse-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel :required="!isAlter">{{ t('modules.clickhouse.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="busy || isAlter"
            :placeholder="t('modules.clickhouse.ddl.dbNamePh')"
            @keydown.enter="onConfirm"
          />
        </div>

        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.clickhouse.ddl.dbEngine') }}</RsLabel>
          <RsSelect
            v-model="engine"
            :options="engineOptions"
            :disabled="busy || isAlter"
            :placeholder="t('modules.clickhouse.ddl.dbEnginePh')"
            searchable
            creatable
          />
        </div>

        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.clickhouse.ddl.dbComment') }}</RsLabel>
          <RsInput
            v-model="comment"
            :disabled="busy"
            :placeholder="t('modules.clickhouse.ddl.dbCommentPh')"
            @keydown.enter="onConfirm"
          />
        </div>

        <div
          v-if="supportOnCluster"
          class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full"
        >
          <RsLabel>{{ t('modules.clickhouse.ddl.onCluster') }}</RsLabel>
          <RsSelect
            v-model="onCluster"
            :options="clusterOptions"
            :disabled="busy || clustersLoading"
            :placeholder="t('modules.clickhouse.ddl.onClusterPh')"
            clearable
            searchable
            creatable
          />
        </div>
      </form>
    </template>

    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton
        variant="primary"
        :loading="busy"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        {{ confirmText }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./clickhouse-ddl-dialog.css"></style>
