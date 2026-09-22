<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { defaultAuth } from '../utils/collection-io'
import type { ApiAuthType, ApiRequest } from '../types'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()

const typeOptions = computed<RsSelectOption[]>(() => [
  { value: 'none', label: t('modules.api.authNone') },
  { value: 'bearer', label: t('modules.api.authBearer') },
  { value: 'basic', label: t('modules.api.authBasic') },
  { value: 'apikey', label: t('modules.api.authApiKey') },
])

const apiKeyInOptions = computed<RsSelectOption[]>(() => [
  { value: 'header', label: t('modules.api.authInHeader') },
  { value: 'query', label: t('modules.api.authInQuery') },
])

const authType = computed({
  get: () => props.request.auth.type,
  set: (value: string) => {
    const type = value as ApiAuthType
    props.request.auth = { ...defaultAuth(), type }
    if (type === 'bearer') props.request.auth.bearer = { token: '' }
    if (type === 'basic') props.request.auth.basic = { username: '', password: '' }
    if (type === 'apikey') props.request.auth.apiKey = { key: '', value: '', in: 'header' }
  },
})

const bearerToken = computed({
  get: () => props.request.auth.bearer?.token ?? '',
  set: (value: string) => {
    props.request.auth.bearer = { token: value }
  },
})

const basicUser = computed({
  get: () => props.request.auth.basic?.username ?? '',
  set: (value: string) => {
    props.request.auth.basic = {
      username: value,
      password: props.request.auth.basic?.password ?? '',
    }
  },
})

const basicPass = computed({
  get: () => props.request.auth.basic?.password ?? '',
  set: (value: string) => {
    props.request.auth.basic = {
      username: props.request.auth.basic?.username ?? '',
      password: value,
    }
  },
})

const apiKeyName = computed({
  get: () => props.request.auth.apiKey?.key ?? '',
  set: (value: string) => {
    props.request.auth.apiKey = {
      key: value,
      value: props.request.auth.apiKey?.value ?? '',
      in: props.request.auth.apiKey?.in ?? 'header',
    }
  },
})

const apiKeyValue = computed({
  get: () => props.request.auth.apiKey?.value ?? '',
  set: (value: string) => {
    props.request.auth.apiKey = {
      key: props.request.auth.apiKey?.key ?? '',
      value,
      in: props.request.auth.apiKey?.in ?? 'header',
    }
  },
})

const apiKeyIn = computed({
  get: () => props.request.auth.apiKey?.in ?? 'header',
  set: (value: string) => {
    props.request.auth.apiKey = {
      key: props.request.auth.apiKey?.key ?? '',
      value: props.request.auth.apiKey?.value ?? '',
      in: value === 'query' ? 'query' : 'header',
    }
  },
})
</script>

<template>
  <div class="nm-api-auth">
    <div class="nm-api-auth__field">
      <RsLabel>{{ t('modules.api.authType') }}</RsLabel>
      <RsSelect
        v-model="authType"
        :options="typeOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        :filter-option="false"
      />
    </div>

    <template v-if="authType === 'bearer'">
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authToken') }}</RsLabel>
        <RsInput v-model="bearerToken" size="sm" radius="sm" spellcheck="false" :placeholder="'{{token}}'" />
      </div>
    </template>

    <template v-else-if="authType === 'basic'">
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authUsername') }}</RsLabel>
        <RsInput v-model="basicUser" size="sm" radius="sm" autocomplete="off" />
      </div>
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authPassword') }}</RsLabel>
        <RsInput v-model="basicPass" size="sm" radius="sm" type="password" autocomplete="off" />
      </div>
    </template>

    <template v-else-if="authType === 'apikey'">
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authKeyName') }}</RsLabel>
        <RsInput v-model="apiKeyName" size="sm" radius="sm" spellcheck="false" />
      </div>
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authKeyValue') }}</RsLabel>
        <RsInput v-model="apiKeyValue" size="sm" radius="sm" spellcheck="false" />
      </div>
      <div class="nm-api-auth__field">
        <RsLabel>{{ t('modules.api.authKeyIn') }}</RsLabel>
        <RsSelect
          v-model="apiKeyIn"
          :options="apiKeyInOptions"
          size="sm"
          radius="sm"
          :searchable="false"
          :clearable="false"
          :filter-option="false"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-api-auth {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  overflow: auto;
}

.nm-api-auth__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
