<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RsCodeEditorDiagnostic } from '@ruoshui/ui'
import { RsButton, RsCodeEditor } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const plainCode = ref('// 在此输入任意文本…')

const jsonCode = ref('{\n  "name": "ruoshui",\n  "version": "1.0.0"\n}')

const tsCode = ref(`export function greet(name: string) {
  return \`Hello, \${name}!\`
}`)

const sqlCode = ref(`SELECT id, name
FROM users
WHERE status = 'active'
ORDER BY created_at DESC;`)

const readonlyCode = ref(`{
  "readonly": true,
  "note": "只读模式不可编辑"
}`)

const disabledCode = ref('disabled 状态下不可聚焦与编辑')

const configCode = ref('{\n  "timeout": 30,\n  "retries": "invalid"\n}')

const jsonDiagnostics = computed<RsCodeEditorDiagnostic[]>(() => {
  try {
    JSON.parse(configCode.value)
    return []
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    return [{ message, line: 3, column: 14, severity: 'error' }]
  }
})

const mixedDiagnostics: RsCodeEditorDiagnostic[] = [
  { message: '未使用的变量 foo', line: 2, column: 7, severity: 'warning' },
  { message: '建议使用严格相等 ===', line: 4, column: 11, severity: 'info' },
  { message: '缺少分号', line: 5, column: 1, severity: 'error' },
]

const lintCode = ref(`const foo = 1
function check(value) {
  if (value == null) return false
  return true
}`)

const languages = [
  { key: 'plaintext', label: 'Plaintext' },
  { key: 'json', label: 'JSON' },
  { key: 'typescript', label: 'TypeScript' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'css', label: 'CSS' },
  { key: 'html', label: 'HTML' },
  { key: 'sql', label: 'SQL' },
] as const

const activeLanguage = ref<(typeof languages)[number]['key']>('json')
const languageSample = ref('{\n  "language": "json"\n}')

function setLanguage(lang: (typeof languages)[number]['key']) {
  activeLanguage.value = lang
  const samples: Record<(typeof languages)[number]['key'], string> = {
    plaintext: '任意纯文本内容',
    json: '{\n  "language": "json"\n}',
    typescript: 'type User = { id: string; name: string }',
    javascript: 'export default { name: "ruoshui" }',
    css: '.editor { font-family: monospace; }',
    html: '<main class="app">Hello</main>',
    sql: 'SELECT * FROM tasks LIMIT 10;',
  }
  languageSample.value = samples[lang]
}
</script>

<template>
  <DemoPage title="RsCodeEditor" test-file="RsCodeEditor.spec.ts">
    <DemoBlock title="基础编辑 v-model">
      <p class="hint">
        通过 <code>v-model</code> 双向绑定代码字符串；工具栏左侧展示当前
        <code>language</code>。
      </p>
      <RsCodeEditor v-model="plainCode" language="plaintext" :height="160" />
      <p class="value">字符数：<code>{{ plainCode.length }}</code></p>
    </DemoBlock>

    <DemoBlock title="语言 language">
      <p class="hint">
        支持 <code>plaintext</code>、<code>json</code>、<code>typescript</code> 等；切换后工具栏标签同步更新。
      </p>
      <div class="lang-tabs">
        <RsButton
          v-for="lang in languages"
          :key="lang.key"
          size="sm"
          :variant="activeLanguage === lang.key ? 'primary' : 'default'"
          @click="setLanguage(lang.key)"
        >
          {{ lang.label }}
        </RsButton>
      </div>
      <RsCodeEditor v-model="languageSample" :language="activeLanguage" :height="140" />
    </DemoBlock>

    <DemoBlock title="JSON 配置">
      <RsCodeEditor v-model="jsonCode" language="json" :height="180" />
    </DemoBlock>

    <DemoBlock title="TypeScript / SQL">
      <div class="stack">
        <RsCodeEditor v-model="tsCode" language="typescript" :height="120" />
        <RsCodeEditor v-model="sqlCode" language="sql" :height="120" />
      </div>
    </DemoBlock>

    <DemoBlock title="高度 height">
      <p class="hint">默认 <code>20rem</code>；可传数字（px）或 CSS 长度字符串。</p>
      <div class="row">
        <div class="editor-col">
          <span class="label">120px</span>
          <RsCodeEditor v-model="plainCode" language="plaintext" :height="120" />
        </div>
        <div class="editor-col">
          <span class="label">12rem</span>
          <RsCodeEditor v-model="plainCode" language="plaintext" height="12rem" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="主题 theme">
      <p class="hint">
        <code>auto</code> 跟随文档 <code>data-rs-theme</code>；也可强制
        <code>light</code> / <code>dark</code>。
      </p>
      <div class="row">
        <div class="editor-col">
          <span class="label">auto</span>
          <RsCodeEditor v-model="jsonCode" language="json" theme="auto" :height="120" />
        </div>
        <div class="editor-col">
          <span class="label">light</span>
          <RsCodeEditor v-model="jsonCode" language="json" theme="light" :height="120" />
        </div>
        <div class="editor-col">
          <span class="label">dark</span>
          <RsCodeEditor v-model="jsonCode" language="json" theme="dark" :height="120" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="placeholder 占位">
      <RsCodeEditor
        model-value=""
        language="plaintext"
        placeholder="// 空内容时显示占位提示"
        :height="100"
      />
    </DemoBlock>

    <DemoBlock title="readonly / disabled">
      <div class="stack">
        <div>
          <span class="label">readonly</span>
          <RsCodeEditor v-model="readonlyCode" language="json" readonly :height="100" />
        </div>
        <div>
          <span class="label">disabled</span>
          <RsCodeEditor v-model="disabledCode" language="plaintext" disabled :height="80" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="诊断信息 diagnostics">
      <p class="hint">
        传入 <code>diagnostics</code> 数组后在底部展示错误 / 警告 / 提示，支持行号与列号。
      </p>
      <div class="stack">
        <div>
          <span class="label">JSON 实时校验</span>
          <RsCodeEditor
            v-model="configCode"
            language="json"
            :diagnostics="jsonDiagnostics"
            :height="140"
          />
        </div>
        <div>
          <span class="label">混合严重级别</span>
          <RsCodeEditor
            v-model="lintCode"
            language="javascript"
            :diagnostics="mixedDiagnostics"
            :height="160"
          />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="toolbar 插槽">
      <RsCodeEditor v-model="jsonCode" language="json" :height="160">
        <template #toolbar>
          <RsButton size="sm" variant="ghost">格式化</RsButton>
          <RsButton size="sm">保存</RsButton>
        </template>
      </RsCodeEditor>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.editor-col {
  flex: 1 1 14rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.label {
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}
.value {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
}
.lang-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}
</style>
