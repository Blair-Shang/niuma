<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVastDdlDialog } from '@/modules/vastbase/composables/useVastDdlDialog'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import {
  buildGrantRevokeSql,
  defaultPrivileges,
  privilegesForTarget,
} from '@/modules/vastbase/utils/grant-privileges'
import type { VastGrantTarget } from '@/modules/vastbase/stores/ddl-actions'

const { t } = useI18n()
const { open, pending, store } = useVastDdlDialog()
const nav = useConnectionNavigation()

const mode = ref<'GRANT' | 'REVOKE'>('GRANT')
const privileges = ref<string[]>(['SELECT'])
const grantee = ref('PUBLIC')
const withGrantOption = ref(false)

const privilegeOptions = computed((): RsSelectOptions =>
  privilegesForTarget(pending.value?.grantTarget).map((p) => ({ value: p, label: p })),
)

const modeOptions = computed((): RsSelectOptions => [
  { value: 'GRANT', label: t('modules.vastbase.ddl.grantModeGrant') },
  { value: 'REVOKE', label: t('modules.vastbase.ddl.grantModeRevoke') },
])

const grantOptionChoices = computed((): RsSelectOptions => [
  { value: 'no', label: t('modules.vastbase.ddl.grantOptionNo') },
  { value: 'yes', label: t('modules.vastbase.ddl.grantOptionYes') },
])

const grantOptionModel = computed({
  get: () => (withGrantOption.value ? 'yes' : 'no'),
  set: (v: string) => {
    withGrantOption.value = v === 'yes'
  },
})

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

const objectKindLabel = computed(() => {
  const target = pending.value?.grantTarget
  if (!target) return ''
  return t(`modules.vastbase.ddl.grantTarget.${target}`)
})

const objectDisplay = computed(() => {
  const req = pending.value
  if (!req) return ''
  if (req.grantTarget === 'schema') return req.name
  const base = req.schema ? `${req.schema}.${req.name}` : req.name
  if (
    (req.grantTarget === 'function' || req.grantTarget === 'procedure') &&
    req.args != null &&
    req.args !== ''
  ) {
    return `${base}(${req.args})`
  }
  return base
})

const previewSql = computed(() => {
  const req = pending.value
  if (!req || req.kind !== 'grant') return ''
  return buildGrantRevokeSql({
    mode: mode.value,
    target: req.grantTarget,
    schema: req.schema,
    name: req.name,
    args: req.args,
    privileges: privileges.value,
    grantee: grantee.value,
    withGrantOption: mode.value === 'GRANT' && withGrantOption.value,
  })
})

const canConfirm = computed(
  () =>
    pending.value?.kind === 'grant' &&
    privileges.value.length > 0 &&
    grantee.value.trim().length > 0 &&
    previewSql.value.length > 0,
)

function resetForTarget(target: VastGrantTarget | undefined): void {
  mode.value = 'GRANT'
  privileges.value = defaultPrivileges(target)
  grantee.value = 'PUBLIC'
  withGrantOption.value = false
}

watch(
  () => pending.value,
  (req) => {
    if (req?.kind === 'grant') {
      resetForTarget(req.grantTarget)
    }
  },
  { immediate: true },
)

watch(privilegeOptions, (opts) => {
  const allowed = new Set(
    opts.flatMap((o) => ('value' in o ? [String(o.value)] : [])),
  )
  const next = privileges.value.filter((p) => allowed.has(p))
  if (next.length === 0) {
    privileges.value = defaultPrivileges(pending.value?.grantTarget)
  } else if (next.length !== privileges.value.length) {
    privileges.value = next
  }
})

function onConfirm(): void {
  const req = pending.value
  if (!req || req.kind !== 'grant' || !canConfirm.value) return
  const sql = previewSql.value
  const database = req.database
  const schema = req.schema
  const path = database
    ? {
        segments: [
          { kind: 'database' as const, name: database },
          ...(schema ? [{ kind: 'schema' as const, name: schema }] : []),
        ],
      }
    : undefined
  nav.connect(
    req.conn,
    {
      ...(path ? { resourcePath: path } : {}),
      initialTab: 'query',
      initialSql: sql,
    },
    { forceNew: true },
  )
  store.clear()
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
      <form class="nm-vast-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.vastbase.ddl.grantObject') }}</RsLabel>
          <RsInput :model-value="objectDisplay" disabled />
          <p v-if="objectKindLabel" class="nm-vast-ddl-dialog__hint">
            {{ objectKindLabel }}
          </p>
        </div>
        <div class="nm-vast-ddl-dialog__grid">
          <div class="nm-vast-ddl-dialog__field">
            <RsLabel required>{{ t('modules.vastbase.ddl.grantMode') }}</RsLabel>
            <RsSelect v-model="mode" :options="modeOptions" />
          </div>
          <div class="nm-vast-ddl-dialog__field">
            <RsLabel required>{{ t('modules.vastbase.ddl.grantPrivilege') }}</RsLabel>
            <RsSelect v-model="privileges" :options="privilegeOptions" multiple searchable />
          </div>
        </div>
        <div class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.vastbase.ddl.grantGrantee') }}</RsLabel>
          <RsInput
            v-model="grantee"
            :placeholder="t('modules.vastbase.ddl.grantGranteePh')"
            @keydown.enter="onConfirm"
          />
        </div>
        <div v-if="mode === 'GRANT'" class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.vastbase.ddl.grantOption') }}</RsLabel>
          <RsSelect v-model="grantOptionModel" :options="grantOptionChoices" />
        </div>
        <div v-if="previewSql" class="nm-vast-ddl-dialog__field nm-vast-ddl-dialog__field--full">
          <RsLabel>{{ t('modules.vastbase.ddl.grantPreview') }}</RsLabel>
          <pre class="nm-vast-ddl-dialog__preview">{{ previewSql }}</pre>
        </div>
      </form>
    </template>

    <template #footer>
      <RsButton variant="ghost" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="primary" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.vastbase.ddl.confirmGrant') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./vast-ddl-dialog.css"></style>
