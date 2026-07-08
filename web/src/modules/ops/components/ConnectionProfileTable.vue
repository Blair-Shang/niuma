<script setup lang="ts">
import { RsButton, RsEmpty, RsTable, type RsTableColumn } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnItem } from '@/modules/ops/types'

interface ProfileRow extends Record<string, unknown> {
  id: string
  profileName: string
  hostAddress: string
  portNumber: number
  loginAccount: string
  protocolLabel: string
  profile: ConnItem
}

const props = defineProps<{
  profiles: ConnItem[]
  protocolLabel: (profile: ConnItem) => string
}>()

const emit = defineEmits<{
  connect: [profile: ConnItem]
  edit: [profile: ConnItem]
  delete: [profile: ConnItem]
}>()

const { t } = useI18n()

const columns = computed((): RsTableColumn<ProfileRow>[] => [
  { key: 'profileName', title: t('modules.ftp.columns.name'), sortable: true, ellipsis: true, minWidth: 140 },
  { key: 'hostAddress', title: t('modules.ftp.columns.host'), sortable: true, ellipsis: true, minWidth: 160 },
  { key: 'portNumber', title: t('modules.ftp.columns.port'), sortable: true, align: 'right', width: 80 },
  { key: 'loginAccount', title: t('modules.ftp.columns.account'), sortable: true, ellipsis: true, minWidth: 120 },
  { key: 'protocolLabel', title: t('modules.ftp.columns.protocol'), sortable: true, width: 88 },
  { key: 'actions', title: t('modules.ftp.columns.actions'), width: 220 },
])

const rows = computed((): ProfileRow[] =>
  props.profiles.map((profile) => ({
    id: profile.profileId,
    profileName: profile.profileName,
    hostAddress: profile.hostAddress,
    portNumber: profile.portNumber,
    loginAccount: profile.loginAccount,
    protocolLabel: props.protocolLabel(profile),
    profile,
  })),
)

function onRowDblclick(row: ProfileRow): void {
  emit('connect', row.profile)
}
</script>

<template>
  <RsTable
    :columns="columns"
    :data="rows"
    row-key="id"
    size="sm"
    striped
    :bordered="false"
    @row-dblclick="onRowDblclick"
  >
    <template #empty>
      <RsEmpty :description="t('modules.ftp.empty')" />
    </template>
    <template #actions="{ row }">
      <div class="nm-conn-profile-table__actions">
        <RsButton size="sm" variant="primary" @click="emit('connect', row.profile)">
          {{ t('modules.ftp.connect') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" @click="emit('edit', row.profile)">
          {{ t('modules.ftp.editSite') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" @click="emit('delete', row.profile)">
          {{ t('modules.ftp.delete') }}
        </RsButton>
      </div>
    </template>
  </RsTable>
</template>

<style scoped>
.nm-conn-profile-table__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-xs);
}
</style>
