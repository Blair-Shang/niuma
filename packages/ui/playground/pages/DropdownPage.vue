<script setup lang="ts">
import { ref } from 'vue'
import { RsDropdown, type RsDropdownItem, type RsDropdownItemGroup } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

/** 场景切换 — 扁平列表 */
const scene = ref('chat')
const sceneItems: RsDropdownItem[] = [
  { label: '对话', value: 'chat', icon: 'message-square' },
  { label: '编程', value: 'code', icon: 'folder' },
  { label: '知识库', value: 'kb', icon: 'search' },
]

/** 二级分组 — 创作 / 检索 */
const mode = ref('chat')
const groupedItems: RsDropdownItemGroup[] = [
  {
    label: '创作',
    options: [
      { label: '对话', value: 'chat', icon: 'message-square' },
      { label: '编程', value: 'code', icon: 'folder' },
      { label: '写作', value: 'write', icon: 'pen-line' },
    ],
  },
  {
    label: '检索',
    options: [
      { label: '知识库', value: 'kb', icon: 'search' },
      { label: '联网', value: 'web', icon: 'globe' },
    ],
  },
]

/** 默认选中 — 编辑回显 */
const plan = ref('pro')
const planItems: RsDropdownItem[] = [
  { label: 'Free', value: 'free' },
  { label: 'Pro', value: 'pro' },
  { label: 'Enterprise', value: 'enterprise' },
]

/** i18n 默认占位 — 不传 placeholder */
const localeDemo = ref('')
const localeItems: RsDropdownItem[] = [
  { label: '选项 A', value: 'a' },
  { label: '选项 B', value: 'b' },
]

/** 禁用整控件 */
const locked = ref('chat')

/** 部分选项禁用 */
const engine = ref('gpt-4o')
const engineItems: RsDropdownItem[] = [
  { label: 'GPT-4o', value: 'gpt-4o', icon: 'sparkles' },
  { label: 'Claude 3.5', value: 'claude-35', icon: 'bot' },
  { label: 'Gemini 2.0（即将上线）', value: 'gemini', icon: 'zap', disabled: true },
  { label: '企业专属（无权限）', value: 'enterprise', icon: 'lock', disabled: true },
]

/** 操作菜单 — 选中不回显 */
const lastAction = ref('')
const actionItems: RsDropdownItem[] = [
  { label: '复制链接', value: 'copy', icon: 'link' },
  { label: '导出 PDF', value: 'export', icon: 'download' },
  { label: '删除', value: 'delete', icon: 'trash-2' },
]

/** 多分组 + 深层二级项 */
const workspace = ref('design-ui')
const workspaceItems: RsDropdownItemGroup[] = [
  {
    label: '设计',
    options: [
      { label: 'UI 稿', value: 'design-ui', icon: 'layout' },
      { label: '原型', value: 'design-proto', icon: 'layers' },
    ],
  },
  {
    label: '开发',
    options: [
      { label: '前端', value: 'dev-fe', icon: 'code' },
      { label: '后端', value: 'dev-be', icon: 'server' },
      { label: 'DevOps', value: 'dev-ops', icon: 'settings' },
    ],
  },
  {
    label: '运营',
    options: [
      { label: '数据分析', value: 'ops-analytics', icon: 'bar-chart-3' },
      { label: '用户增长', value: 'ops-growth', icon: 'trending-up' },
    ],
  },
]
</script>

<template>
  <DemoPage title="RsDropdown" test-file="RsDropdown.spec.ts">
    <DemoBlock title="场景切换（扁平列表）">
      <p class="hint">最常见的模式切换：带图标的一级选项，单选互斥。</p>
      <RsDropdown v-model="scene" :items="sceneItems" />
      <p class="value-hint">当前值：<code>{{ scene }}</code></p>
    </DemoBlock>

    <DemoBlock title="二级分组（OptGroup）">
      <p class="hint">
        `items` 传入 `RsDropdownItemGroup[]`：一级为分组标题，二级为可选项（与 RsSelect 分组语义一致）。
      </p>
      <RsDropdown v-model="mode" :items="groupedItems" placeholder="选择模式" />
      <p class="value-hint">当前值：<code>{{ mode }}</code></p>
    </DemoBlock>

    <DemoBlock title="多分组 + 图标">
      <p class="hint">三组二级选项，选中后触发器展示对应二级项 label。</p>
      <RsDropdown v-model="workspace" :items="workspaceItems" placeholder="选择工作区" />
      <p class="value-hint">当前值：<code>{{ workspace }}</code></p>
    </DemoBlock>

    <DemoBlock title="默认选中（编辑回显）">
      <p class="hint">`v-model` 初始值对应某选项时，触发器直接显示其 label。</p>
      <RsDropdown v-model="plan" :items="planItems" />
      <p class="value-hint">当前值：<code>{{ plan }}</code></p>
    </DemoBlock>

    <DemoBlock title="i18n 默认占位">
      <p class="hint">不传 `placeholder` 时使用 `t('dropdown.placeholder')`，随 Playground 语言切换。</p>
      <RsDropdown v-model="localeDemo" :items="localeItems" />
      <p class="value-hint">当前值：<code>{{ localeDemo || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="操作菜单（不回显）">
      <p class="hint">
        `show-selected="false"`：触发器固定显示 placeholder，选中后仅触发 `@select`，适合「更多操作」类菜单。
      </p>
      <RsDropdown
        :items="actionItems"
        :show-selected="false"
        placeholder="更多操作"
        @select="lastAction = $event"
      />
      <p class="value-hint">最近操作：<code>{{ lastAction || '（未选择）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="禁用整控件">
      <RsDropdown v-model="locked" :items="sceneItems" disabled />
      <p class="value-hint">当前值：<code>{{ locked }}</code>（不可操作）</p>
    </DemoBlock>

    <DemoBlock title="部分选项禁用">
      <p class="hint">`disabled: true` 的二级项不可选，其余正常。</p>
      <RsDropdown v-model="engine" :items="engineItems" placeholder="选择模型" />
      <p class="value-hint">当前值：<code>{{ engine }}</code></p>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.value-hint {
  margin: 0.5rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.value-hint code {
  font-size: inherit;
  color: var(--rs-text);
}
</style>
