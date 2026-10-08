<script setup lang="ts">
import { RsButton, RsCodeEditor, RsTabs, type RsCodeEditorLanguage, type RsTabItem, useRsToast } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import type { ApiRequest } from '../../types'
import { useApiTesterStore } from '../../stores/api-tester'
import { SNIPPET_LANGS, buildSnippet, snippetEditorLanguage, type SnippetLang } from '../utils/snippet'

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const appStore = useAppStore()
const api = useApiTesterStore()
const emit = defineEmits<{
  close: []
}>()

const lang = ref<SnippetLang>('curl')

const langItems = computed<RsTabItem[]>(() =>
  SNIPPET_LANGS.map((item) => ({ value: item, label: t(`modules.api.codeLang.${item}`) })),
)

const source = computed(() =>
  buildSnippet(lang.value, props.request, api.environment, props.requestId ? api.variableScope(props.requestId) : undefined),
)

const editorLanguage = computed(() => snippetEditorLanguage(lang.value) as RsCodeEditorLanguage)

async function copySource(): Promise<void> {
  if (!source.value) return
  try {
    await navigator.clipboard.writeText(source.value)
    toast.success(t('modules.api.copied'))
  } catch {
    toast.error(t('modules.api.copyFailed'))
  }
}
</script>

<template>
  <div class="nm-api-code">
    <div class="nm-api-code__bar">
      <RsTabs
        v-model="lang"
        class="nm-api-code__langs"
        :items="langItems"
        size="sm"
        variant="line"
        panelless
        borderless
        content-gap="none"
        overflow="scroll"
      />
      <RsButton
        variant="ghost"
        size="sm"
        icon="copy"
        icon-only
        :tooltip="t('modules.api.copyCode')"
        :aria-label="t('modules.api.copyCode')"
        @click="copySource"
      />
      <RsButton
        variant="ghost"
        size="sm"
        icon="x"
        icon-only
        :aria-label="t('common.close')"
        @click="emit('close')"
      />
    </div>
    <RsCodeEditor
      :model-value="source"
      :language="editorLanguage"
      :theme="appStore.editorTheme"
      :show-toolbar="false"
      readonly
      embedded
      height="100%"
    />
  </div>
</template>

<style scoped>
.nm-api-code {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.nm-api-code__bar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-height: 2rem;
  padding-inline-end: var(--rs-space-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-api-code__langs {
  flex: 1;
  min-width: 0;
}

.nm-api-code :deep(.rs-code-editor) {
  flex: 1;
  min-height: 0;
}
</style>
