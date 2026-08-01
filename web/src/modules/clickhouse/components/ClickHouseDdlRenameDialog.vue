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

const newName = ref('')

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const canConfirm = computed(() => {
  if (!pending.value || pending.value.kind !== 'rename') return false
  const next = newName.value.trim()
  return next.length > 0 && next !== pending.value.name
})

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'rename') return
    newName.value = req.newName ?? req.name ?? ''
    void reloadClusters({
      profileId: req.profileId,
      preferred: req.createOptions?.onCluster,
    })
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'rename' || !canConfirm.value) return
  await exec({
    newName: newName.value.trim(),
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
    width="sm"
    layout="confirm"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <div class="nm-clickhouse-ddl-dialog__form">
        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.clickhouse.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.clickhouse.ddl.newName') }}</RsLabel>
          <RsInput v-model="newName" :disabled="busy" @keydown.enter="onConfirm" />
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
      </div>
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
        {{ t('modules.clickhouse.ddl.confirmRename') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./clickhouse-ddl-dialog.css"></style>
