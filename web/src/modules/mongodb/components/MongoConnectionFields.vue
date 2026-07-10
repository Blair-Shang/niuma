<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_MONGO_OPTIONS } from '@/api/types/mongodb'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const topologyOptions = computed<RsSelectOptions>(() => [
  { value: 'standalone', label: t('modules.mongodb.form.topologyStandalone') },
  { value: 'replica_set', label: t('modules.mongodb.form.topologyReplicaSet') },
  { value: 'sharded', label: t('modules.mongodb.form.topologySharded') },
])

const authMechanismOptions = computed<RsSelectOptions>(() => [
  { value: 'default', label: t('modules.mongodb.form.authDefault') },
  { value: 'scram', label: 'SCRAM' },
  { value: 'x509', label: 'X.509' },
])

const readPreferenceOptions = computed<RsSelectOptions>(() => [
  { value: 'primary', label: t('modules.mongodb.form.readPrimary') },
  { value: 'primaryPreferred', label: t('modules.mongodb.form.readPrimaryPreferred') },
  { value: 'secondary', label: t('modules.mongodb.form.readSecondary') },
  { value: 'secondaryPreferred', label: t('modules.mongodb.form.readSecondaryPreferred') },
  { value: 'nearest', label: t('modules.mongodb.form.readNearest') },
])

const clientDriverOptions = computed<RsSelectOptions>(() => [
  { value: 'default', label: t('modules.mongodb.form.driverDefault') },
  { value: 'legacy', label: t('modules.mongodb.form.driverLegacy') },
])

const srvRecordOptions = computed<RsSelectOptions>(() => [
  { value: 'false', label: t('modules.mongodb.form.srvOff') },
  { value: 'true', label: t('modules.mongodb.form.srvOn') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.topology') }}</RsLabel>
        <RsSelect v-model="form.mongoTopology" :options="topologyOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.srvRecord') }}</RsLabel>
        <RsSelect v-model="form.mongoSrvRecord" :options="srvRecordOptions" />
      </div>
    </div>
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.authMechanism') }}</RsLabel>
        <RsSelect v-model="form.mongoAuthMechanism" :options="authMechanismOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.authDatabase') }}</RsLabel>
        <RsInput v-model="form.mongoAuthDatabase" autocomplete="off" placeholder="admin" />
      </div>
    </div>
    <div v-if="form.mongoTopology === 'replica_set'" class="nm-conn-form__field">
      <RsLabel>{{ t('modules.mongodb.form.replicaSet') }}</RsLabel>
      <RsInput v-model="form.mongoReplicaSet" autocomplete="off" />
    </div>
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.readPreference') }}</RsLabel>
        <RsSelect v-model="form.mongoReadPreference" :options="readPreferenceOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.mongodb.form.clientDriver') }}</RsLabel>
        <RsSelect v-model="form.mongoClientDriver" :options="clientDriverOptions" />
      </div>
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.mongodb.form.defaultDatabase') }}</RsLabel>
      <RsInput v-model="form.mongoDefaultDatabase" autocomplete="off" :placeholder="t('modules.mongodb.form.defaultDatabasePlaceholder')" />
    </div>
    <ConnectionTimeoutFields :form="form" :default-seconds="DEFAULT_MONGO_OPTIONS.timeout_seconds" />
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-form__row {
  display: flex;
  gap: var(--rs-space-md);
}

.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-form__field--grow {
  flex: 1;
  min-width: 0;
}
</style>
