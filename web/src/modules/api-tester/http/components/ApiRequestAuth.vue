<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { shellApi } from '@/api'
import { defaultAuth } from '../../utils/collection-io'
import { useApiTesterStore } from '../../stores/api-tester'
import type { ApiAuthType, ApiOAuth2, ApiRequest } from '../../types'
import { interpolateVariables, resolveRequest } from '../utils/request-resolve'
import { OAuthError, buildAuthorizeUrl, emptyOAuth, ensureOAuthToken, exchangeAuthCode } from '../utils/oauth'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const api = useApiTesterStore()
const tokenBusy = ref(false)
const tokenError = ref('')
const callbackText = ref('')

const typeOptions = computed<RsSelectOption[]>(() => [
  { value: 'none', label: t('modules.api.authNone') },
  { value: 'bearer', label: t('modules.api.authBearer') },
  { value: 'basic', label: t('modules.api.authBasic') },
  { value: 'apikey', label: t('modules.api.authApiKey') },
  { value: 'oauth2', label: t('modules.api.authOAuth2') },
  { value: 'digest', label: t('modules.api.authDigest') },
  { value: 'awsv4', label: t('modules.api.authAws') },
  { value: 'ntlm', label: t('modules.api.authNtlm') },
])

const grantOptions = computed<RsSelectOption[]>(() => [
  { value: 'client_credentials', label: t('modules.api.oauthClientCredentials') },
  { value: 'password', label: t('modules.api.oauthPassword') },
  { value: 'authorization_code', label: t('modules.api.oauthAuthCode') },
])

const clientAuthOptions = computed<RsSelectOption[]>(() => [
  { value: 'basic', label: t('modules.api.oauthClientAuthBasic') },
  { value: 'body', label: t('modules.api.oauthClientAuthBody') },
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
    if (type === 'oauth2') props.request.auth.oauth2 = emptyOAuth()
    if (type === 'digest') props.request.auth.digest = { username: '', password: '' }
    if (type === 'awsv4') props.request.auth.awsv4 = { accessKey: '', secretKey: '', region: '', service: '', sessionToken: '' }
    if (type === 'ntlm') props.request.auth.ntlm = { username: '', password: '', domain: '' }
  },
})

const bearerToken = computed({
  get: () => props.request.auth.bearer?.token ?? '',
  set: (value: string) => {
    props.request.auth.bearer = { token: value }
  },
})

const basicUser = computed({
  get: () => props.request.auth.basic?.username ?? props.request.auth.digest?.username ?? props.request.auth.ntlm?.username ?? '',
  set: (value: string) => {
    if (props.request.auth.type === 'digest') {
      props.request.auth.digest = { username: value, password: props.request.auth.digest?.password ?? '' }
      return
    }
    if (props.request.auth.type === 'ntlm') {
      props.request.auth.ntlm = {
        username: value,
        password: props.request.auth.ntlm?.password ?? '',
        domain: props.request.auth.ntlm?.domain ?? '',
      }
      return
    }
    props.request.auth.basic = {
      username: value,
      password: props.request.auth.basic?.password ?? '',
    }
  },
})

const basicPass = computed({
  get: () => props.request.auth.basic?.password ?? props.request.auth.digest?.password ?? props.request.auth.ntlm?.password ?? '',
  set: (value: string) => {
    if (props.request.auth.type === 'digest') {
      props.request.auth.digest = { username: props.request.auth.digest?.username ?? '', password: value }
      return
    }
    if (props.request.auth.type === 'ntlm') {
      props.request.auth.ntlm = {
        username: props.request.auth.ntlm?.username ?? '',
        password: value,
        domain: props.request.auth.ntlm?.domain ?? '',
      }
      return
    }
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

function patchOAuth(patch: Partial<ApiOAuth2>) {
  props.request.auth.oauth2 = { ...(props.request.auth.oauth2 ?? emptyOAuth()), ...patch }
}

function oauthText(key: keyof ApiOAuth2) {
  return computed({
    get: () => {
      const value = props.request.auth.oauth2?.[key]
      return typeof value === 'string' ? value : ''
    },
    set: (value: string) => patchOAuth({ [key]: value }),
  })
}

const oauthGrant = computed({
  get: () => props.request.auth.oauth2?.grant ?? 'client_credentials',
  set: (value: string) => {
    const grant = value === 'password' || value === 'authorization_code' ? value : 'client_credentials'
    patchOAuth({ grant })
  },
})

const oauthClientAuth = computed({
  get: () => props.request.auth.oauth2?.clientAuth ?? 'basic',
  set: (value: string) => patchOAuth({ clientAuth: value === 'body' ? 'body' : 'basic' }),
})

const oauthAccessTokenUrl = oauthText('accessTokenUrl')
const oauthAuthUrl = oauthText('authUrl')
const oauthCallbackUrl = oauthText('callbackUrl')
const oauthClientId = oauthText('clientId')
const oauthClientSecret = oauthText('clientSecret')
const oauthScope = oauthText('scope')
const oauthUsername = oauthText('username')
const oauthPassword = oauthText('password')

const tokenReady = computed(() => Boolean(props.request.auth.oauth2?.accessToken.trim()))

function interpolate(text: string): string {
  const resolved = resolveRequest(props.request, api.environment, api.variableScope(props.request.id))
  return interpolateVariables(text, resolved.values)
}

function showTokenError(error: unknown) {
  if (error instanceof OAuthError && error.code === 'need-token') {
    tokenError.value = t('modules.api.oauthNeedToken')
    return
  }
  tokenError.value = error instanceof Error ? error.message : String(error)
}

function patchAws(key: 'accessKey' | 'secretKey' | 'region' | 'service' | 'sessionToken', value: string): void {
  const current = props.request.auth.awsv4 ?? { accessKey: '', secretKey: '', region: '', service: '', sessionToken: '' }
  props.request.auth.awsv4 = { ...current, [key]: value }
}

async function fetchToken(): Promise<void> {
  tokenBusy.value = true
  tokenError.value = ''
  try {
    await ensureOAuthToken(props.request, interpolate, props.request.insecureTLS === true, undefined, { force: true })
  } catch (error) {
    showTokenError(error)
  } finally {
    tokenBusy.value = false
  }
}

async function openBrowser() {
  tokenError.value = ''
  try {
    const url = await buildAuthorizeUrl(props.request, interpolate)
    await shellApi.openExternal({ url })
  } catch (error) {
    showTokenError(error)
  }
}

async function exchangeCode() {
  tokenBusy.value = true
  tokenError.value = ''
  try {
    await exchangeAuthCode(
      props.request,
      interpolate,
      callbackText.value,
      props.request.insecureTLS === true,
    )
  } catch (error) {
    showTokenError(error)
  } finally {
    tokenBusy.value = false
  }
}
</script>

<template>
  <div class="nm-api-auth">
    <div class="nm-api-auth__type">
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

    <div class="nm-api-auth__fields">
      <p v-if="authType === 'none'" class="nm-api-auth__hint">{{ t('modules.api.authNoneHint') }}</p>

      <template v-else-if="authType === 'bearer'">
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authToken') }}</RsLabel>
          <RsInput v-model="bearerToken" size="sm" radius="sm" spellcheck="false" :placeholder="'{{token}}'" />
        </div>
      </template>

      <template v-else-if="authType === 'basic' || authType === 'digest' || authType === 'ntlm'">
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authUsername') }}</RsLabel>
          <RsInput v-model="basicUser" size="sm" radius="sm" autocomplete="off" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authPassword') }}</RsLabel>
          <RsInput v-model="basicPass" size="sm" radius="sm" type="password" autocomplete="off" />
        </div>
        <div v-if="authType === 'ntlm'" class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authDomain') }}</RsLabel>
          <RsInput
            :model-value="request.auth.ntlm?.domain ?? ''"
            size="sm"
            radius="sm"
            @update:model-value="request.auth.ntlm = { username: request.auth.ntlm?.username ?? '', password: request.auth.ntlm?.password ?? '', domain: String($event) }"
          />
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

      <template v-else-if="authType === 'oauth2'">
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthGrant') }}</RsLabel>
          <RsSelect
            v-model="oauthGrant"
            :options="grantOptions"
            size="sm"
            radius="sm"
            :searchable="false"
            :clearable="false"
            :filter-option="false"
          />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthAccessTokenUrl') }}</RsLabel>
          <RsInput v-model="oauthAccessTokenUrl" size="sm" radius="sm" spellcheck="false" />
        </div>
        <div v-if="oauthGrant === 'authorization_code'" class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthAuthUrl') }}</RsLabel>
          <RsInput v-model="oauthAuthUrl" size="sm" radius="sm" spellcheck="false" />
        </div>
        <div v-if="oauthGrant === 'authorization_code'" class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthCallback') }}</RsLabel>
          <RsInput v-model="oauthCallbackUrl" size="sm" radius="sm" spellcheck="false" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthClientId') }}</RsLabel>
          <RsInput v-model="oauthClientId" size="sm" radius="sm" spellcheck="false" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthClientSecret') }}</RsLabel>
          <RsInput v-model="oauthClientSecret" size="sm" radius="sm" type="password" autocomplete="off" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthClientAuth') }}</RsLabel>
          <RsSelect
            v-model="oauthClientAuth"
            :options="clientAuthOptions"
            size="sm"
            radius="sm"
            :searchable="false"
            :clearable="false"
            :filter-option="false"
          />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.oauthScope') }}</RsLabel>
          <RsInput v-model="oauthScope" size="sm" radius="sm" spellcheck="false" />
        </div>
        <template v-if="oauthGrant === 'password'">
          <div class="nm-api-auth__field">
            <RsLabel>{{ t('modules.api.authUsername') }}</RsLabel>
            <RsInput v-model="oauthUsername" size="sm" radius="sm" autocomplete="off" />
          </div>
          <div class="nm-api-auth__field">
            <RsLabel>{{ t('modules.api.authPassword') }}</RsLabel>
            <RsInput v-model="oauthPassword" size="sm" radius="sm" type="password" autocomplete="off" />
          </div>
        </template>
        <div class="nm-api-auth__actions">
          <RsButton
            v-if="oauthGrant !== 'authorization_code'"
            size="sm"
            radius="sm"
            variant="primary"
            :disabled="tokenBusy"
            @click="fetchToken"
          >
            {{ t('modules.api.oauthGetToken') }}
          </RsButton>
          <RsButton v-else size="sm" radius="sm" variant="primary" @click="openBrowser">
            {{ t('modules.api.oauthOpenBrowser') }}
          </RsButton>
        </div>
        <template v-if="oauthGrant === 'authorization_code'">
          <div class="nm-api-auth__field">
            <RsLabel>{{ t('modules.api.oauthCallbackPaste') }}</RsLabel>
            <RsInput v-model="callbackText" size="sm" radius="sm" spellcheck="false" />
          </div>
          <div class="nm-api-auth__actions">
            <RsButton size="sm" radius="sm" variant="text" :disabled="tokenBusy" @click="exchangeCode">
              {{ t('modules.api.oauthExchange') }}
            </RsButton>
          </div>
        </template>
        <p v-if="tokenReady" class="nm-api-auth__hint">{{ t('modules.api.oauthTokenReady') }}</p>
        <p v-if="tokenError" class="nm-api-auth__hint nm-api-auth__hint--danger">{{ tokenError }}</p>
      </template>

      <template v-else-if="authType === 'awsv4'">
        <div class="nm-api-auth__field">
          <RsLabel>Access Key</RsLabel>
          <RsInput :model-value="request.auth.awsv4?.accessKey ?? ''" size="sm" spellcheck="false" @update:model-value="patchAws('accessKey', String($event))" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>Secret Key</RsLabel>
          <RsInput :model-value="request.auth.awsv4?.secretKey ?? ''" size="sm" type="password" @update:model-value="patchAws('secretKey', String($event))" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authAwsRegion') }}</RsLabel>
          <RsInput :model-value="request.auth.awsv4?.region ?? ''" size="sm" spellcheck="false" placeholder="us-east-1" @update:model-value="patchAws('region', String($event))" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authAwsService') }}</RsLabel>
          <RsInput :model-value="request.auth.awsv4?.service ?? ''" size="sm" spellcheck="false" placeholder="execute-api" @update:model-value="patchAws('service', String($event))" />
        </div>
        <div class="nm-api-auth__field">
          <RsLabel>{{ t('modules.api.authAwsSession') }}</RsLabel>
          <RsInput :model-value="request.auth.awsv4?.sessionToken ?? ''" size="sm" spellcheck="false" @update:model-value="patchAws('sessionToken', String($event))" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.nm-api-auth {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  align-items: flex-start;
  padding: var(--rs-space-md) var(--rs-space-lg);
  overflow: auto;
}

.nm-api-auth__type,
.nm-api-auth__fields {
  width: min(100%, 22rem);
}

.nm-api-auth__fields:has(.nm-api-auth__actions) {
  width: min(100%, 28rem);
}

.nm-api-auth__type,
.nm-api-auth__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-api-auth__fields {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-width: 0;
}

.nm-api-auth__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
}

.nm-api-auth__hint--danger {
  color: var(--rs-danger, var(--rs-color-danger, #c42b2b));
}

.nm-api-auth__actions {
  display: flex;
  gap: var(--rs-space-sm);
}
</style>
