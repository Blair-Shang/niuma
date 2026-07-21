<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsMonacoEditor } from '@ruoshui/ui'
import type { MonacoLanguage } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

// ── 基础 JSON 编辑 ──────────────────────────────────────────────────────
const jsonCode = ref('{\n  "name": "niuma",\n  "version": "1.0.0",\n  "active": true\n}')

// ── 不同语言 ─────────────────────────────────────────────────────────
const languages: { key: MonacoLanguage; label: string; sample: string }[] = [
  { key: 'json', label: 'JSON', sample: '{\n  "language": "json",\n  "valid": true\n}' },
  { key: 'javascript', label: 'JavaScript', sample: 'export function greet(name) {\n  return `Hello, ${name}!`\n}' },
  { key: 'typescript', label: 'TypeScript', sample: 'interface User {\n  id: string\n  name: string\n}\n\nexport function getUser(id: string): User {\n  return { id, name: "Alice" }\n}' },
  { key: 'sql', label: 'SQL', sample: 'SELECT\n  u.id,\n  u.name,\n  COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.status = \'active\'\nGROUP BY u.id, u.name\nORDER BY orders DESC\nLIMIT 20;' },
  { key: 'yaml', label: 'YAML', sample: 'server:\n  host: localhost\n  port: 8080\n\ndatabase:\n  url: mongodb://localhost:27017\n  name: niuma\n  maxPoolSize: 10' },
]
const activeLang = ref<MonacoLanguage>('json')
const langSample = ref(languages[0].sample)

function switchLang(lang: (typeof languages)[number]) {
  activeLang.value = lang.key
  langSample.value = lang.sample
}

// ── readonly ────────────────────────────────────────────────────────────
const readonlyJson = ref('{\n  "note": "此编辑器为只读模式，内容不可修改",\n  "readonly": true\n}')

// ── minimap ─────────────────────────────────────────────────────────────
function fieldValue(i: number): string | number | boolean {
  if (i % 3 === 0) return '"string"'
  if (i % 3 === 1) return i * 10
  return true
}
const minimapCode = ref(
  Array.from({ length: 30 }, (_, i) => `  "field_${String(i + 1).padStart(2, '0')}": ${fieldValue(i)}`)
    .join(',\n')
    .replace(/^/, '{\n')
    .replace(/$/, '\n}'),
)
const showMinimap = ref(true)

// ── JSON Schema 校验 ─────────────────────────────────────────────────────
const schemaJson = ref('{\n  "name": "Alice",\n  "age": 25,\n  "email": "alice@example.com"\n}')
const userSchema = {
  type: 'object',
  required: ['name', 'age'],
  properties: {
    name: { type: 'string', description: '用户姓名' },
    age: { type: 'number', minimum: 0, maximum: 150, description: '年龄（0–150）' },
    email: { type: 'string', format: 'email', description: 'Email 地址' },
  },
  additionalProperties: false,
}

// ── MongoDB 聚合管道（实际使用场景） ──────────────────────────────────────
const mongoEditorRef = ref<InstanceType<typeof RsMonacoEditor> | null>(null)
const mongoPipeline = ref(`[
  {
    "$match": {
      "status": "active",
      "age": { "$gte": 18 }
    }
  },
  {
    "$group": {
      "_id": "$department",
      "count": { "$sum": 1 },
      "avgAge": { "$avg": "$age" }
    }
  },
  {
    "$sort": { "count": -1 }
  },
  {
    "$limit": 10
  }
]`)

function formatMongoPipeline(): void {
  mongoEditorRef.value?.format()
}

// ── 主题 ─────────────────────────────────────────────────────────────────
const themeCode = ref('{\n  "theme": "示例",\n  "value": 42\n}')
</script>

<template>
  <DemoPage title="RsMonacoEditor" test-file="—">
    <!-- 基础 JSON -->
    <DemoBlock title="基础 JSON 编辑">
      <p class="hint">
        内置 VS Code（Monaco）编辑器内核，支持 JSON 语法高亮、括号匹配、代码折叠、
        格式化（<kbd>Shift+Alt+F</kbd>）、查找替换（<kbd>Ctrl+H</kbd>）。
      </p>
      <RsMonacoEditor v-model="jsonCode" language="json" :height="200" />
      <p class="value">字符数：<code>{{ jsonCode.length }}</code></p>
    </DemoBlock>

    <!-- 多语言 -->
    <DemoBlock title="语言 language">
      <p class="hint">支持 <code>json</code>、<code>javascript</code>、<code>typescript</code>、<code>sql</code>、<code>yaml</code>。</p>
      <div class="lang-tabs">
        <RsButton
          v-for="lang in languages"
          :key="lang.key"
          size="sm"
          :variant="activeLang === lang.key ? 'primary' : 'default'"
          @click="switchLang(lang)"
        >
          {{ lang.label }}
        </RsButton>
      </div>
      <RsMonacoEditor v-model="langSample" :language="activeLang" :height="160" />
    </DemoBlock>

    <!-- JSON Schema 验证 -->
    <DemoBlock title="JSON Schema 验证">
      <p class="hint">
        传入 <code>jsonSchema</code> 后，编辑器自动校验结构。
        尝试修改 <code>age</code> 为字符串或删除必填字段 <code>name</code>，
        即可看到行内错误提示（红色波浪线）和悬浮说明。
      </p>
      <RsMonacoEditor
        v-model="schemaJson"
        language="json"
        :height="180"
        :json-schema="userSchema"
      />
      <details class="schema-detail">
        <summary>查看 Schema 定义</summary>
        <pre class="schema-pre">{{ JSON.stringify(userSchema, null, 2) }}</pre>
      </details>
    </DemoBlock>

    <!-- MongoDB 聚合管道（实际场景） -->
    <DemoBlock title="MongoDB 聚合管道（实际使用场景）">
      <p class="hint">
        与 MongoQueryPane 中一样的编辑器体验：多行 JSON 数组、折叠、格式化。
      </p>
      <div class="action-bar">
        <RsButton size="sm" variant="ghost" @click="formatMongoPipeline">
          格式化（Shift+Alt+F）
        </RsButton>
      </div>
      <RsMonacoEditor
        ref="mongoEditorRef"
        v-model="mongoPipeline"
        language="json"
        :height="280"
      />
    </DemoBlock>

    <!-- Readonly -->
    <DemoBlock title="只读 readonly">
      <RsMonacoEditor
        v-model="readonlyJson"
        language="json"
        :height="130"
        :readonly="true"
      />
    </DemoBlock>

    <!-- Minimap -->
    <DemoBlock title="Minimap">
      <p class="hint">
        适合大文件时快速定位；可通过 <code>:minimap="true"</code> 开启。
      </p>
      <label class="toggle-row">
        <input v-model="showMinimap" type="checkbox" />
        <span>显示 Minimap</span>
      </label>
      <RsMonacoEditor
        v-model="minimapCode"
        language="json"
        :height="240"
        :minimap="showMinimap"
      />
    </DemoBlock>

    <!-- 主题 -->
    <DemoBlock title="主题 theme">
      <p class="hint">
        <code>auto</code> 跟随文档 <code>data-rs-theme</code>（默认）；
        也可强制 <code>vs-dark</code> / <code>light</code>。
      </p>
      <div class="row">
        <div class="editor-col">
          <span class="label">auto</span>
          <RsMonacoEditor v-model="themeCode" language="json" theme="auto" :height="120" />
        </div>
        <div class="editor-col">
          <span class="label">light</span>
          <RsMonacoEditor v-model="themeCode" language="json" theme="light" :height="120" />
        </div>
        <div class="editor-col">
          <span class="label">vs-dark</span>
          <RsMonacoEditor v-model="themeCode" language="json" theme="vs-dark" :height="120" />
        </div>
      </div>
    </DemoBlock>

    <!-- 高度 -->
    <DemoBlock title="高度 height">
      <p class="hint">传数字（px）或 CSS 字符串如 <code>'12rem'</code>、<code>'100%'</code>。</p>
      <div class="row">
        <div class="editor-col">
          <span class="label">100px</span>
          <RsMonacoEditor v-model="jsonCode" language="json" :height="100" />
        </div>
        <div class="editor-col">
          <span class="label">200px</span>
          <RsMonacoEditor v-model="jsonCode" language="json" :height="200" />
        </div>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.5;
}
.hint code,
.hint kbd {
  font-size: 0.85em;
  padding: 0.1em 0.3em;
  border-radius: 3px;
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  color: var(--rs-text);
}
.lang-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
}
.action-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.schema-detail {
  margin-top: 0.75rem;
  font-size: var(--rs-font-size-xs);
}
.schema-detail summary {
  cursor: pointer;
  color: var(--rs-muted);
  user-select: none;
}
.schema-pre {
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-subtle);
  font-size: var(--rs-font-size-xs);
  font-family: var(--rs-font-mono);
  line-height: 1.5;
  overflow: auto;
  max-height: 16rem;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
  user-select: none;
}
.value {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
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
</style>
