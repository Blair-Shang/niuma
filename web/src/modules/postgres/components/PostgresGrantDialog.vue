<script setup lang="ts">
import { RsButton, RsCheckbox, RsDialog, RsInput, RsLabel, RsSelect, RsTooltip, useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { postgresApi } from '@/api'
import type { PostgresDdlAction, PostgresDdlParams } from '@/api/types/postgres'
import { usePostgresDdlDialog } from '@/modules/postgres/composables/usePostgresDdlDialog'
import { usePostgresDdlExec } from '@/modules/postgres/composables/usePostgresDdlExec'
import type { PostgresPendingDdlAction } from '@/modules/postgres/stores/ddl-actions'

const PRIVS: Record<string, string[]> = {
  table: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'ALL'],
  view: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'ALL'],
  materialized_view: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'ALL'],
  sequence: ['USAGE', 'SELECT', 'UPDATE', 'ALL'],
  schema: ['USAGE', 'CREATE', 'ALL'],
  function: ['EXECUTE', 'ALL'],
  procedure: ['EXECUTE', 'ALL'],
  database: ['CONNECT', 'CREATE', 'TEMPORARY', 'ALL'],
}

function defaultPrivileges(kind: string): string[] {
  switch (kind) {
    case 'function':
    case 'procedure':
      return ['EXECUTE']
    case 'schema':
      return ['USAGE']
    case 'sequence':
      return ['USAGE']
    case 'database':
      return ['CONNECT']
    default:
      return ['SELECT']
  }
}

const { t } = useI18n()
const toast = useRsToast()
const { open, pending, store } = usePostgresDdlDialog()
const { exec, busy } = usePostgresDdlExec()

const mode = ref<'grant' | 'revoke'>('grant')
const grantee = ref('PUBLIC')
const grantOption = ref(false)
const selected = ref<string[]>(['SELECT'])
const ownerOptions = ref<RsSelectOptions>([
  { value: 'PUBLIC', label: 'PUBLIC' },
  { value: 'CURRENT_USER', label: 'CURRENT_USER' },
])
const currentAcl = ref('')
const loading = ref(false)

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')
const objectKind = computed(() => pending.value?.objectKind || 'table')
const privilegeOptions = computed(() => PRIVS[objectKind.value] ?? PRIVS.table)
const isPublicGrantee = computed(() => grantee.value.trim().toUpperCase() === 'PUBLIC')
const canGrantOption = computed(() => mode.value === 'grant' && !isPublicGrantee.value)
const canConfirm = computed(
  () =>
    pending.value?.kind === 'grant' &&
    grantee.value.trim().length > 0 &&
    selected.value.some((p) => privilegeOptions.value.includes(p)),
)

async function loadContext(req: PostgresPendingDdlAction): Promise<void> {
  loading.value = true
  try {
    const opts = await postgresApi.metaDatabaseCreateOptions({ profileId: req.profileId })
    const roles = (opts.owners ?? []).map((o) => ({ value: o, label: o }))
    ownerOptions.value = [
      { value: 'PUBLIC', label: 'PUBLIC' },
      { value: 'CURRENT_USER', label: 'CURRENT_USER' },
      ...roles.filter((r) => r.value !== 'CURRENT_USER' && r.value !== 'PUBLIC'),
    ]
    const privs = await postgresApi.metaPrivileges({
      profileId: req.profileId,
      database: req.database,
      schema: req.schema,
      name: req.name,
      args: req.args,
      oid: req.oid,
      kind: req.objectKind,
    })
    currentAcl.value = (privs.grants ?? [])
      .map((g) => `${g.grantee}: ${g.privilege}${g.grantable ? ' (grantable)' : ''}`)
      .join('\n')
  } catch (e) {
    currentAcl.value = ''
    toast.error(e instanceof Error ? e.message : t('modules.postgres.ddl.optionsLoadError'))
  } finally {
    loading.value = false
  }
}

watch(
  () => pending.value,
  (req) => {
    if (req?.kind !== 'grant') return
    mode.value = 'grant'
    grantee.value = 'PUBLIC'
    grantOption.value = false
    selected.value = defaultPrivileges(req.objectKind || 'table')
    void loadContext(req)
  },
  { immediate: true },
)

watch(isPublicGrantee, (isPublic) => {
  if (isPublic) grantOption.value = false
})

function togglePriv(priv: string, on: boolean): void {
  if (on) {
    if (priv === 'ALL') {
      selected.value = ['ALL']
      return
    }
    selected.value = [...selected.value.filter((p) => p !== 'ALL' && p !== priv), priv]
    return
  }
  selected.value = selected.value.filter((p) => p !== priv)
}

function buildPayload(req: PostgresPendingDdlAction): PostgresDdlParams {
  return {
    action: mode.value as PostgresDdlAction,
    profileId: req.profileId,
    database: req.database,
    schema: req.schema,
    name: req.name,
    args: req.args,
    oid: req.oid,
    objectKind: req.objectKind,
    grantee: grantee.value.trim(),
    privileges: selected.value,
    grantOption: canGrantOption.value && grantOption.value,
  }
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'grant' || !canConfirm.value) return
  await exec(buildPayload(req))
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="md"
    layout="form"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-kb-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.postgres.ddl.currentName') }}</RsLabel>
          <RsInput :model-value="pending?.name ?? ''" disabled />
        </div>
        <div class="nm-kb-ddl-dialog__field">
          <RsLabel required>{{ t('modules.postgres.ddl.grantMode') }}</RsLabel>
          <RsSelect
            v-model="mode"
            :options="[
              { value: 'grant', label: 'GRANT' },
              { value: 'revoke', label: 'REVOKE' },
            ]"
            :disabled="busy"
          />
        </div>
        <div class="nm-kb-ddl-dialog__field">
          <RsLabel required>{{ t('modules.postgres.ddl.grantee') }}</RsLabel>
          <RsSelect v-model="grantee" :options="ownerOptions" :disabled="busy || loading" searchable />
        </div>
        <div class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.postgres.ddl.privileges') }}</RsLabel>
          <div class="nm-pg-grant__privs">
            <RsCheckbox
              v-for="priv in privilegeOptions"
              :key="priv"
              :model-value="selected.includes(priv)"
              :disabled="busy"
              @update:model-value="togglePriv(priv, $event === true)"
            >
              {{ priv }}
            </RsCheckbox>
          </div>
        </div>
        <div v-if="mode === 'grant'" class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsTooltip
            v-if="!canGrantOption"
            icon
            :content="t('modules.postgres.ddl.grantOptionPublicHint')"
            side="top"
            align="start"
          >
            <RsCheckbox v-model="grantOption" :disabled="busy || !canGrantOption">
              {{ t('modules.postgres.ddl.grantOption') }}
            </RsCheckbox>
          </RsTooltip>
          <RsCheckbox v-else v-model="grantOption" :disabled="busy">
            {{ t('modules.postgres.ddl.grantOption') }}
          </RsCheckbox>
        </div>
        <div v-if="currentAcl" class="nm-kb-ddl-dialog__field nm-kb-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.postgres.ddl.currentAcl') }}</RsLabel>
          <pre class="nm-pg-grant__acl">{{ currentAcl }}</pre>
        </div>
      </form>
    </template>
    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ mode === 'revoke' ? t('modules.postgres.ddl.confirmRevoke') : t('modules.postgres.ddl.confirmGrant') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./postgres-ddl-dialog.css"></style>
<style scoped>
.nm-pg-grant__privs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
}
.nm-pg-grant__acl {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  padding: var(--rs-space-xs);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  font: inherit;
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
