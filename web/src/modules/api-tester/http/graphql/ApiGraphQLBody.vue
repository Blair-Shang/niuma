<script setup lang="ts">
import { RsButton, RsCodeEditor, RsLabel } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiTesterStore } from '../../stores/api-tester'
import { useAppStore } from '@/stores/app'
import type { ApiRequest } from '../../types'
import { emptyGraphQL, INTROSPECTION_QUERY } from './body'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const api = useApiTesterStore()
const appStore = useAppStore()
const schemaText = ref('')
const schemaError = ref('')

async function introspect(): Promise<void> {
  schemaError.value = ''
  const draft = {
    ...props.request,
    bodyMode: 'graphql' as const,
    graphql: { query: INTROSPECTION_QUERY, variables: '' },
    preRequestScript: '',
    testScript: '',
    checks: [],
    preSteps: [],
  }
  try {
    const exchange = await api.sendResolved(draft, { skipHistory: true })
    schemaText.value = exchange.body
    if (!exchange.ok) schemaError.value = exchange.error || exchange.statusText
  } catch (error) {
    schemaError.value = error instanceof Error ? error.message : String(error)
  }
}

function current() {
  return props.request.graphql ?? emptyGraphQL()
}

const query = computed({
  get: () => current().query,
  set: (value: string) => {
    props.request.graphql = { ...current(), query: value }
  },
})

const variables = computed({
  get: () => current().variables,
  set: (value: string) => {
    props.request.graphql = { ...current(), variables: value }
  },
})

const variablesInvalid = computed(() => {
  const text = variables.value.trim()
  if (!text) return false
  try {
    JSON.parse(text)
    return false
  } catch {
    return true
  }
})
</script>

<template>
  <div class="nm-api-graphql">
    <div class="nm-api-graphql__pane">
      <div class="nm-api-graphql__label">
        <RsLabel>Query</RsLabel>
        <RsButton size="sm" variant="ghost" @click="introspect">{{ t('modules.api.graphqlIntrospect') }}</RsButton>
      </div>
      <RsCodeEditor
        v-model="query"
        language="plaintext"
        :theme="appStore.editorTheme"
        :show-toolbar="false"
        embedded
        height="100%"
      />
    </div>
    <div class="nm-api-graphql__pane">
      <RsLabel>Variables</RsLabel>
      <p v-if="variablesInvalid" class="nm-api-graphql__error">{{ t('modules.api.graphqlVariables') }}</p>
      <RsCodeEditor
        v-model="variables"
        language="json"
        :theme="appStore.editorTheme"
        :show-toolbar="false"
        embedded
        height="100%"
      />
    </div>
    <p v-if="schemaError" class="nm-api-graphql__error">{{ schemaError }}</p>
    <pre v-if="schemaText" class="nm-api-graphql__schema">{{ schemaText }}</pre>
  </div>
</template>

<style scoped>
.nm-api-graphql {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.nm-api-graphql__pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--rs-space-sm) var(--rs-space-md) 0;
}

.nm-api-graphql__pane :deep(.rs-code-editor) {
  flex: 1;
  min-height: 0;
}

.nm-api-graphql__error {
  margin: 0 0 var(--rs-space-xs);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-xs);
}

.nm-api-graphql__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nm-api-graphql__schema {
  max-height: 10rem;
  margin: 0;
  overflow: auto;
  padding: var(--rs-space-xs) var(--rs-space-md);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  white-space: pre-wrap;
}
</style>
