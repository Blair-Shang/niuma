<script setup lang="ts">
import { RsButton, RsDialog, RsLabel, RsSelect } from '@niuma/ui'
import { computed, watch } from 'vue'
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
  reset: resetClusters,
  resolveOnCluster,
} = useClickHouseClusterOptions()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const showCluster = computed(() => {
  const action = pending.value?.action
  return Boolean(action && action !== 'reload_dictionary' && supportOnCluster.value)
})

watch(
  () => pending.value,
  (req) => {
    if (!req || req.kind === 'rename' || req.kind === 'create_database') {
      resetClusters()
      return
    }
    if (req.action === 'reload_dictionary') {
      resetClusters()
      return
    }
    void reloadClusters({
      profileId: req.profileId,
      preferred: req.createOptions?.onCluster,
    })
  },
  { immediate: true },
)

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind === 'rename' || req.kind === 'create_database') return
  if (req.action === 'reload_dictionary') {
    await exec()
    return
  }
  await exec({
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
    width="sm"
    layout="confirm"
    tone="danger"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <div class="nm-clickhouse-ddl-dialog__form">
        <p class="nm-clickhouse-ddl-dialog__desc">{{ description }}</p>
        <div
          v-if="showCluster"
          class="nm-clickhouse-ddl-dialog__field nm-clickhouse-ddl-dialog__field--full"
        >
          <RsLabel>{{ t('modules.clickhouse.ddl.onCluster') }}</RsLabel>
          <RsSelect
            v-model="onCluster"
            :options="clusterOptions"
            :disabled="busy || clustersLoading"
            :placeholder="t('modules.clickhouse.ddl.onClusterPhDanger')"
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
      <RsButton variant="danger" :loading="busy" @click="onConfirm">
        {{ t('modules.clickhouse.ddl.confirmExec') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./clickhouse-ddl-dialog.css"></style>
