<script setup lang="ts">
import {
  RsButton,
  RsCheckbox,
  RsDialog,
  RsInput,
  RsLabel,
  RsSelect,
  RsTooltip,
  useRsToast,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useSqlServerDatabaseCreateForm } from '@/modules/sqlserver/composables/useSqlServerDatabaseCreateForm'
import { useSqlServerDdlDialog } from '@/modules/sqlserver/composables/useSqlServerDdlDialog'
import { useSqlServerDdlExec } from '@/modules/sqlserver/composables/useSqlServerDdlExec'
import type { DatabaseNameError } from '@/modules/sqlserver/utils/create-database'

const { t } = useI18n()
const toast = useRsToast()
const nav = useConnectionNavigation()
const { open, pending, store } = useSqlServerDdlDialog()
const { exec, busy } = useSqlServerDdlExec()
const {
  dbName,
  collation,
  recovery,
  compatSelect,
  customizeFiles,
  dataLogical,
  dataPath,
  dataSizeMb,
  dataGrowthMb,
  logLogical,
  logPath,
  logSizeMb,
  logGrowthMb,
  filesTouched,
  azure,
  formDisabled,
  optionsLoading,
  nameError,
  canConfirm,
  collationOptions,
  recoveryOptions,
  compatOptions,
  previewSql,
  defaultDataDir,
} = useSqlServerDatabaseCreateForm()

const title = computed(() => pending.value?.title ?? '')
const description = computed(() => pending.value?.description ?? '')

// 未输入前不显示「请输入数据库名」；重名等实质错误始终显示
const nameTouched = ref(false)
watch(dbName, () => {
  nameTouched.value = true
})
const visibleNameError = computed(() => {
  if (!nameError.value) return undefined
  if (nameError.value === 'empty' && !nameTouched.value) return undefined
  return nameError.value
})

function nameErrorText(code: DatabaseNameError | undefined): string {
  if (!code) return ''
  return t(`modules.sqlserver.createDb.nameError.${code}`)
}

async function onConfirm(): Promise<void> {
  const req = pending.value
  if (!req || req.kind !== 'create_database' || !canConfirm.value) return
  const sql = previewSql.value.trim()
  if (!sql) return
  await exec(sql, {
    successMessage: t('modules.sqlserver.createDb.createOk', { name: dbName.value.trim() }),
  })
}

function onScriptToQuery(): void {
  const req = pending.value
  const sql = previewSql.value.trim()
  if (!req || !sql || !canConfirm.value) return
  nav.connect(req.conn, { initialTab: 'query', initialSql: sql })
  store.clear()
}

async function onCopySql(): Promise<void> {
  const sql = previewSql.value.trim()
  if (!sql) return
  try {
    await navigator.clipboard.writeText(sql)
    toast.success(t('modules.sqlserver.createDb.copySqlOk'))
  } catch {
    toast.error(t('modules.sqlserver.createDb.copySqlFailed'))
  }
}

function markFilesTouched(): void {
  filesTouched.value = true
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    :description="description"
    width="lg"
    layout="form"
    tone="default"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-sqlserver-ddl-dialog__form" autocomplete="off" @submit.prevent="onConfirm">
        <p v-if="optionsLoading" class="nm-sqlserver-ddl-dialog__hint">
          {{ t('modules.sqlserver.createDb.loadingOptions') }}
        </p>
        <div class="nm-sqlserver-ddl-dialog__field nm-sqlserver-ddl-dialog__field--full">
          <RsLabel required>{{ t('modules.sqlserver.createDb.dbName') }}</RsLabel>
          <RsInput
            v-model="dbName"
            :disabled="formDisabled"
            :placeholder="t('modules.sqlserver.createDb.dbNamePh')"
            @keydown.enter.prevent="onConfirm"
          />
          <p v-if="visibleNameError" class="nm-sqlserver-ddl-dialog__error">
            {{ nameErrorText(visibleNameError) }}
          </p>
        </div>

        <div class="nm-sqlserver-ddl-dialog__grid">
          <div class="nm-sqlserver-ddl-dialog__field">
            <RsTooltip icon :content="t('modules.sqlserver.createDb.collationHint')" side="top" align="start">
              <RsLabel>{{ t('modules.sqlserver.createDb.collation') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="collation"
              :options="collationOptions"
              :disabled="formDisabled"
              searchable
            />
          </div>
          <div v-if="!azure" class="nm-sqlserver-ddl-dialog__field">
            <RsTooltip icon :content="t('modules.sqlserver.createDb.recoveryHint')" side="top" align="start">
              <RsLabel>{{ t('modules.sqlserver.createDb.recovery') }}</RsLabel>
            </RsTooltip>
            <RsSelect
              v-model="recovery"
              :options="recoveryOptions"
              :disabled="formDisabled"
            />
          </div>
          <div v-else class="nm-sqlserver-ddl-dialog__field">
            <RsLabel>{{ t('modules.sqlserver.createDb.recovery') }}</RsLabel>
            <p class="nm-sqlserver-ddl-dialog__hint">{{ t('modules.sqlserver.createDb.azureManaged') }}</p>
          </div>
        </div>

        <div class="nm-sqlserver-ddl-dialog__field">
          <RsTooltip icon :content="t('modules.sqlserver.createDb.compatHint')" side="top" align="start">
            <RsLabel>{{ t('modules.sqlserver.createDb.compat') }}</RsLabel>
          </RsTooltip>
          <RsSelect
            v-model="compatSelect"
            :options="compatOptions"
            :disabled="formDisabled"
          />
        </div>

        <template v-if="!azure && defaultDataDir">
          <RsCheckbox v-model="customizeFiles" :disabled="formDisabled">
            {{ t('modules.sqlserver.createDb.customizeFiles') }}
          </RsCheckbox>
          <p class="nm-sqlserver-ddl-dialog__hint">{{ t('modules.sqlserver.createDb.customizeFilesHint') }}</p>
        </template>
        <p v-else-if="azure" class="nm-sqlserver-ddl-dialog__hint">
          {{ t('modules.sqlserver.createDb.azureNoFiles') }}
        </p>

        <div v-if="customizeFiles && !azure" class="nm-sqlserver-ddl-dialog__files">
          <div class="nm-sqlserver-ddl-dialog__files-title">{{ t('modules.sqlserver.createDb.fileData') }}</div>
          <div class="nm-sqlserver-ddl-dialog__grid">
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileLogical') }}</RsLabel>
              <RsInput v-model="dataLogical" :disabled="formDisabled" @input="markFilesTouched" />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.filePath') }}</RsLabel>
              <RsInput v-model="dataPath" :disabled="formDisabled" @input="markFilesTouched" />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileSize') }}</RsLabel>
              <RsInput
                :model-value="String(dataSizeMb)"
                type="number"
                :disabled="formDisabled"
                @update:model-value="dataSizeMb = Math.max(1, Math.trunc(Number($event) || 1))"
              />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileGrowth') }}</RsLabel>
              <RsInput
                :model-value="String(dataGrowthMb)"
                type="number"
                :disabled="formDisabled"
                @update:model-value="dataGrowthMb = Math.max(0, Math.trunc(Number($event) || 0))"
              />
            </div>
          </div>
          <div class="nm-sqlserver-ddl-dialog__files-title">{{ t('modules.sqlserver.createDb.fileLog') }}</div>
          <div class="nm-sqlserver-ddl-dialog__grid">
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileLogical') }}</RsLabel>
              <RsInput v-model="logLogical" :disabled="formDisabled" @input="markFilesTouched" />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.filePath') }}</RsLabel>
              <RsInput v-model="logPath" :disabled="formDisabled" @input="markFilesTouched" />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileSize') }}</RsLabel>
              <RsInput
                :model-value="String(logSizeMb)"
                type="number"
                :disabled="formDisabled"
                @update:model-value="logSizeMb = Math.max(1, Math.trunc(Number($event) || 1))"
              />
            </div>
            <div class="nm-sqlserver-ddl-dialog__field">
              <RsLabel>{{ t('modules.sqlserver.createDb.fileGrowth') }}</RsLabel>
              <RsInput
                :model-value="String(logGrowthMb)"
                type="number"
                :disabled="formDisabled"
                @update:model-value="logGrowthMb = Math.max(0, Math.trunc(Number($event) || 0))"
              />
            </div>
          </div>
        </div>

        <div class="nm-sqlserver-ddl-dialog__field nm-sqlserver-ddl-dialog__field--full">
          <div class="nm-sqlserver-ddl-dialog__preview-head">
            <RsLabel>{{ t('modules.sqlserver.createDb.previewSql') }}</RsLabel>
            <RsButton size="sm" variant="ghost" :disabled="!previewSql" @click="onCopySql">
              {{ t('modules.sqlserver.createDb.copySql') }}
            </RsButton>
          </div>
          <pre class="nm-sqlserver-ddl-dialog__preview">{{ previewSql || '—' }}</pre>
        </div>
      </form>
    </template>
    <template #footer>
      <RsButton variant="ghost" :disabled="busy" @click="store.clear()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="!canConfirm || busy" @click="onScriptToQuery">
        {{ t('modules.sqlserver.createDb.scriptToQuery') }}
      </RsButton>
      <RsButton variant="primary" :loading="busy" :disabled="!canConfirm" @click="onConfirm">
        {{ t('modules.sqlserver.createDb.confirmCreate') }}
      </RsButton>
    </template>
  </RsDialog>
</template>

<style scoped src="./sqlserver-ddl-dialog.css"></style>
