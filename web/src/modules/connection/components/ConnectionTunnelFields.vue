<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TunnelFormState } from '@/modules/connection/types'

const props = defineProps<{
  form: TunnelFormState
  sshProfiles?: Array<{
    profileId: string
    profileName: string
    hostAddress: string
    portNumber: number
  }>
}>()

const { t } = useI18n()

const tunnelTypeOptions = computed<RsSelectOptions>(() => [
  { value: 'none', label: t('connection.form.tunnelNone') },
  { value: 'ssh', label: 'SSH Tunnel' },
])

const tunnelEnabled = computed(() => props.form.tunnelType !== 'none')

const sshProfileOptions = computed<RsSelectOptions>(() => {
  const options = (props.sshProfiles ?? []).map((profile) => ({
    value: profile.profileId,
    label: `${profile.profileName} (${profile.hostAddress}:${profile.portNumber || 22})`,
  }))
  const selected = props.form.tunnelSshProfileId.trim()
  if (selected && !options.some((opt) => opt.value === selected)) {
    options.unshift({
      value: selected,
      label: t('connection.form.tunnelSshProfileMissing', { id: selected }),
    })
  }
  return options
})
</script>

<template>
  <div class="nm-conn-tunnel">
    <p class="nm-conn-tunnel__hint">{{ t('connection.form.tunnelHint') }}</p>
    <section class="nm-conn-tunnel__section">
      <div class="nm-conn-tunnel__field">
        <RsLabel>{{ t('connection.form.tunnelType') }}</RsLabel>
        <RsSelect v-model="form.tunnelType" :options="tunnelTypeOptions" />
      </div>
    </section>
    <section v-if="tunnelEnabled" class="nm-conn-tunnel__section">
      <div class="nm-conn-tunnel__field">
        <RsLabel required>{{ t('connection.form.tunnelSshProfileId') }}</RsLabel>
        <RsSelect
          v-model="form.tunnelSshProfileId"
          :options="sshProfileOptions"
          :placeholder="t('connection.form.tunnelSshProfilePlaceholder')"
          :search-placeholder="t('connection.form.tunnelSshProfileSearch')"
          :empty-text="t('connection.form.tunnelSshProfileEmpty')"
          searchable
          clearable
          virtual
        />
        <p class="nm-conn-tunnel__hint">{{ t('connection.form.tunnelSshProfileHint') }}</p>
      </div>
      <div class="nm-conn-tunnel__row">
        <div class="nm-conn-tunnel__field nm-conn-tunnel__field--grow">
          <RsLabel>{{ t('connection.form.tunnelTargetHost') }}</RsLabel>
          <RsInput
            v-model="form.tunnelTargetHost"
            :placeholder="t('connection.form.tunnelTargetHostPlaceholder')"
          />
        </div>
        <div class="nm-conn-tunnel__field nm-conn-tunnel__field--port">
          <RsLabel>{{ t('connection.form.tunnelTargetPort') }}</RsLabel>
          <RsInput
            v-model="form.tunnelTargetPort"
            :placeholder="t('connection.form.tunnelTargetPortPlaceholder')"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nm-conn-tunnel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-conn-tunnel__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-tunnel__row {
  display: flex;
  gap: var(--rs-space-md);
}

.nm-conn-tunnel__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-tunnel__field--grow {
  flex: 1;
  min-width: 0;
}

.nm-conn-tunnel__field--port {
  width: 5.5rem;
  flex-shrink: 0;
}

.nm-conn-tunnel__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
