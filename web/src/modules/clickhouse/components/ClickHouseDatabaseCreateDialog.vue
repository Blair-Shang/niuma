<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClickHouseClusterOptions } from '@/modules/clickhouse/composables/useClickHouseClusterOptions'
import { useClickHouseDdlDialog } from '@/modules/clickhouse/composables/useClickHouseDdlDialog'
import { useClickHouseDdlExec } from '@/modules/clickhouse/composables/useClickHouseDdlExec'

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

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'create_database') return false
  return dbName.value.trim().length > 0
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'create_database') return
    dbName.value = req.name || ''
    void reloadClusters({
      profileId: req.profileId,
      preferred: req.createOptions?.onCluster,
    })
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_database' || !canConfirm.value) return
  await exec({
    newName: dbName.value.trim(),
    createOptions: {
      onCluster: resolveOnCluster(),
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
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-clickhouse-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.clickhouse.ddl.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="busy"
            :placeholder="t('modules.clickhouse.ddl.dbNamePh')"
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
        {{ t('modules.clickhouse.ddl.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./clickhouse-ddl-dialog.css"></style>
