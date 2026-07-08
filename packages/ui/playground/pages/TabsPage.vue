<script setup lang="ts">
import { computed, ref } from 'vue'
import { RsButton, RsTabs, reorderTabItems, type RsTabItem } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicTab = ref('overview')

const basicItems: RsTabItem[] = [
  { value: 'overview', label: '概览' },
  { value: 'analytics', label: '分析' },
  { value: 'settings', label: '设置' },
]

const iconTab = ref('dashboard')

const iconItems: RsTabItem[] = [
  { value: 'dashboard', label: '仪表盘', icon: 'layout-dashboard' },
  { value: 'chat', label: '对话', icon: 'message-square' },
  { value: 'settings', label: '设置', icon: 'settings' },
]

const badgeTab = ref('inbox')

const badgeItems: RsTabItem[] = [
  { value: 'inbox', label: '收件箱', badge: 12 },
  { value: 'drafts', label: '草稿', badge: 3 },
  { value: 'sent', label: '已发送' },
]

const disabledTab = ref('general')

const disabledItems: RsTabItem[] = [
  { value: 'general', label: '常规' },
  { value: 'security', label: '安全', disabled: true },
  { value: 'billing', label: '账单' },
]

const panellessTab = ref('list')

const panellessItems: RsTabItem[] = [
  { value: 'list', label: '列表视图', icon: 'layers' },
  { value: 'grid', label: '网格视图', icon: 'layout-grid' },
  { value: 'kanban', label: '看板', icon: 'columns-3' },
]

const detailTab = ref('activity')

const detailItems: RsTabItem[] = [
  { value: 'overview', label: '概览' },
  { value: 'activity', label: '动态', badge: 5 },
  { value: 'members', label: '成员', icon: 'users' },
  { value: 'settings', label: '设置', icon: 'settings' },
]

const settingsTab = ref('profile')

const settingsItems: RsTabItem[] = [
  { value: 'profile', label: '个人资料', icon: 'user' },
  { value: 'notifications', label: '通知', icon: 'bell', badge: '新' },
  { value: 'api', label: 'API 密钥', icon: 'key' },
]

const panellessLabel = computed(
  () => panellessItems.find((item) => item.value === panellessTab.value)?.label ?? '',
)

const editableTab = ref('doc-1')
let editableSeed = 3

const editableItems = ref<RsTabItem[]>([
  { value: 'doc-1', label: '未命名文档 1' },
  { value: 'doc-2', label: '产品需求.md', closable: true },
  { value: 'doc-3', label: '接口设计.md', closable: true },
])

function onEditableAdd() {
  editableSeed += 1
  const value = `doc-${editableSeed}`
  editableItems.value = [
    ...editableItems.value,
    { value, label: `未命名文档 ${editableSeed}`, closable: true },
  ]
  editableTab.value = value
}

function onEditableClose(value: string) {
  editableItems.value = editableItems.value.filter((item) => item.value !== value)
  if (!editableItems.value.length) {
    editableTab.value = ''
    return
  }
  if (!editableItems.value.some((item) => item.value === editableTab.value)) {
    editableTab.value = editableItems.value[0]!.value
  }
}

const pinnedTab = ref('home')

const pinnedItems = ref<RsTabItem[]>([
  { value: 'home', label: '首页', closable: false },
  { value: 'workspace-a', label: '工作区 A', closable: true },
  { value: 'workspace-b', label: '工作区 B', closable: true },
])

function onPinnedClose(value: string) {
  pinnedItems.value = pinnedItems.value.filter((item) => item.value !== value)
  if (!pinnedItems.value.some((item) => item.value === pinnedTab.value)) {
    pinnedTab.value = pinnedItems.value[0]?.value ?? ''
  }
}

let pinnedSeed = 2

function onPinnedAdd() {
  pinnedSeed += 1
  const value = `workspace-${pinnedSeed}`
  pinnedItems.value = [
    ...pinnedItems.value,
    { value, label: `工作区 ${pinnedSeed}`, closable: true },
  ]
  pinnedTab.value = value
}

const cardTab = ref('tab-1')

const cardItems = ref<RsTabItem[]>([
  { value: 'tab-1', label: '标签 1' },
  { value: 'tab-2', label: '标签 2' },
  { value: 'tab-3', label: '标签 3' },
])

const dragTab = ref('alpha')

const dragItems = ref<RsTabItem[]>([
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
  { value: 'delta', label: 'Delta' },
])

function onDragReorder(from: string, to: string) {
  dragItems.value = reorderTabItems(dragItems.value, from, to)
}

const renameTab = ref('readme')

const renameItems = ref<RsTabItem[]>([
  { value: 'readme', label: 'README.md', renamable: true },
  { value: 'changelog', label: 'CHANGELOG.md', renamable: true },
  { value: 'license', label: 'LICENSE', renamable: false },
])

function onTabRename(value: string, label: string) {
  renameItems.value = renameItems.value.map((item) =>
    item.value === value ? { ...item, label } : item,
  )
}

const scrollTab = ref('tab-1')

const scrollItems = Array.from({ length: 12 }, (_, index) => ({
  value: `tab-${index + 1}`,
  label: `工作流 ${index + 1}`,
}))

const overflowTab = ref('tab-1')

const overflowItems = Array.from({ length: 10 }, (_, index) => ({
  value: `tab-${index + 1}`,
  label: `模块 ${index + 1}`,
}))
</script>

<template>
  <DemoPage title="RsTabs" test-file="RsTabs.spec.ts">
    <DemoBlock title="基础标签页">
      <p class="hint">
        默认 <code>variant="line"</code> 下划线式；标签栏与内容区在
        <code>rs-tabs__body</code> 内一体呈现。面板内容通过同名插槽
        <code>#value</code> 传入。
      </p>
      <RsTabs v-model="basicTab" :items="basicItems">
        <template #overview>
          <p class="demo-text">应用运行正常，今日请求量 12,480 次。</p>
        </template>
        <template #analytics>
          <p class="demo-text">近 7 日活跃用户 1,024，转化率 3.2%。</p>
        </template>
        <template #settings>
          <p class="demo-text">可在此配置模型参数与访问权限。</p>
        </template>
      </RsTabs>
      <p class="meta">当前标签：<code>{{ basicTab }}</code></p>
    </DemoBlock>

    <DemoBlock title="带图标">
      <p class="hint"><code>icon</code> 使用 Lucide 图标名，显示在标签文字左侧。</p>
      <RsTabs v-model="iconTab" :items="iconItems">
        <template #dashboard>
          <p class="demo-text">仪表盘指标卡片与快捷入口。</p>
        </template>
        <template #chat>
          <p class="demo-text">最近对话列表与新建会话。</p>
        </template>
        <template #settings>
          <p class="demo-text">账户与工作区偏好设置。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="角标（badge）">
      <p class="hint">
        <code>badge</code> 支持数字或短文本，常用于未读数或「新」标记；空字符串不显示。
      </p>
      <RsTabs v-model="badgeTab" :items="badgeItems">
        <template #inbox>
          <p class="demo-text">12 封未读邮件，3 封待回复。</p>
        </template>
        <template #drafts>
          <p class="demo-text">3 篇草稿待完善。</p>
        </template>
        <template #sent>
          <p class="demo-text">已发送邮件归档。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="禁用项">
      <p class="hint"><code>disabled: true</code> 的标签不可切换，样式降低透明度。</p>
      <RsTabs v-model="disabledTab" :items="disabledItems">
        <template #general>
          <p class="demo-text">常规偏好与语言设置。</p>
        </template>
        <template #security>
          <p class="demo-text">（不可访问）</p>
        </template>
        <template #billing>
          <p class="demo-text">订阅方案与发票记录。</p>
        </template>
      </RsTabs>
      <p class="meta">当前标签：<code>{{ disabledTab }}</code></p>
    </DemoBlock>

    <DemoBlock title="小尺寸（sm）">
      <p class="hint"><code>size="sm"</code> 适用于工具栏、卡片页头等紧凑区域。</p>
      <RsTabs v-model="basicTab" :items="basicItems" size="sm">
        <template #overview>
          <p class="demo-text">紧凑模式下的概览内容。</p>
        </template>
        <template #analytics>
          <p class="demo-text">紧凑模式下的分析内容。</p>
        </template>
        <template #settings>
          <p class="demo-text">紧凑模式下的设置内容。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="分段胶囊（segmented）">
      <p class="hint">
        <code>variant="segmented"</code> 适用于工具栏视图切换；面板仍与标签栏在同一容器内。
      </p>
      <RsTabs v-model="panellessTab" :items="panellessItems" variant="segmented">
        <template #list>
          <p class="demo-text">列表视图：行式数据，支持排序与筛选。</p>
        </template>
        <template #grid>
          <p class="demo-text">网格视图：卡片缩略图，适合媒体资源。</p>
        </template>
        <template #kanban>
          <p class="demo-text">看板视图：按状态分列拖拽。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="无内置面板（panelless）">
      <p class="hint">
        <code>panelless</code> 只渲染标签栏，内容由业务侧根据
        <code>v-model</code> 自行切换，适合与路由或复杂布局组合。
      </p>
      <RsTabs v-model="panellessTab" :items="panellessItems" panelless />
      <div class="external-panel">
        <p>当前视图：<strong>{{ panellessLabel }}</strong></p>
        <p class="external-panel__desc">
          外部内容区 — 选中 <code>{{ panellessTab }}</code> 时展示对应业务组件。
        </p>
      </div>
    </DemoBlock>

    <DemoBlock title="可关闭 / 可新增（editable）">
      <p class="hint">
        对齐 Ant Design <code>editable-card</code>、Arco <code>editable</code>、Element
        <code>closable</code> + <code>addable</code>：<code>closable</code> /
        <code>addable</code> 控制交互，<code>@close</code> / <code>@add</code>
        由业务更新 <code>items</code>；关闭当前项时组件会自动切到相邻标签。
      </p>
      <RsTabs
        v-model="editableTab"
        :items="editableItems"
        variant="card"
        closable
        addable
        renamable
        :max-count="6"
        @add="onEditableAdd"
        @close="onEditableClose"
        @rename="(value, label) => {
          editableItems = editableItems.map((item) =>
            item.value === value ? { ...item, label } : item,
          )
        }"
      >
        <template v-for="item in editableItems" :key="item.value" #[item.value]>
          <p class="demo-text">
            编辑区：{{ item.label }}（<code>{{ item.value }}</code>）
          </p>
        </template>
      </RsTabs>
      <p class="meta">
        当前 {{ editableItems.length }} 个标签 · 激活 <code>{{ editableTab }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="固定首项不可关闭">
      <p class="hint">单项设置 <code>closable: false</code> 可固定首页等常驻标签，其余可关。</p>
      <RsTabs
        v-model="pinnedTab"
        :items="pinnedItems"
        closable
        addable
        :max-count="5"
        @add="onPinnedAdd"
        @close="onPinnedClose"
      >
        <template #home>
          <p class="demo-text">首页仪表盘，不可关闭。</p>
        </template>
        <template #workspace-a>
          <p class="demo-text">工作区 A 内容。</p>
        </template>
        <template #workspace-b>
          <p class="demo-text">工作区 B 内容。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="卡片式（card · Ant editable-card）">
      <p class="hint">
        <code>variant="card"</code> 对齐 Ant Design 卡片标签：激活项与内容区边框衔接。
      </p>
      <RsTabs v-model="cardTab" :items="cardItems" variant="card">
        <template v-for="item in cardItems" :key="item.value" #[item.value]>
          <p class="demo-text">{{ item.label }} 面板内容</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="拖拽排序（draggable）">
      <p class="hint">
        拖动标签左侧手柄排序，触发 <code>@reorder</code>；业务侧用
        <code>reorderTabItems</code> 更新数组。
      </p>
      <RsTabs
        v-model="dragTab"
        :items="dragItems"
        variant="card"
        draggable
        closable
        @reorder="onDragReorder"
        @close="(value) => { dragItems = dragItems.filter((i) => i.value !== value) }"
      >
        <template v-for="item in dragItems" :key="item.value" #[item.value]>
          <p class="demo-text">拖拽排序演示：{{ item.label }}</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="双击重命名（renamable）">
      <p class="hint">
        <code>renamable</code> 开启后双击标签名进入编辑；<code>@rename</code>
        回传新标题。单项可用 <code>renamable: false</code> 禁用。
      </p>
      <RsTabs
        v-model="renameTab"
        :items="renameItems"
        variant="card"
        renamable
        @rename="onTabRename"
      >
        <template v-for="item in renameItems" :key="item.value" #[item.value]>
          <p class="demo-text">文件：{{ item.label }}</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="溢出滚动（overflow=scroll）">
      <p class="hint">
        标签过多时横向滚动，两侧出现翻页按钮（对齐 Ant / Arco 滚动标签页）。
      </p>
      <RsTabs v-model="scrollTab" :items="scrollItems" overflow="scroll" closable>
        <template v-for="item in scrollItems" :key="item.value" #[item.value]>
          <p class="demo-text">{{ item.label }} 的配置与运行状态。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="溢出下拉（overflow=dropdown）">
      <p class="hint">
        窄容器下放不下的标签收入「更多」菜单；激活隐藏项时按钮显示当前标签名。
      </p>
      <div class="narrow-tabs">
        <RsTabs v-model="overflowTab" :items="overflowItems" overflow="dropdown">
          <template v-for="item in overflowItems" :key="item.value" #[item.value]>
            <p class="demo-text">{{ item.label }} 详情面板。</p>
          </template>
        </RsTabs>
      </div>
    </DemoBlock>

    <DemoBlock title="项目详情页（业务场景）">
      <p class="hint">详情页顶栏：标题区 + 标签切换不同信息面板。</p>
      <header class="detail-header">
        <div class="detail-header__main">
          <h2 class="detail-header__title">弱水 AI · 小说续写</h2>
          <p class="detail-header__desc">运行中 · 最近更新 2 小时前</p>
        </div>
      </header>
      <RsTabs v-model="detailTab" :items="detailItems" size="sm">
        <template #overview>
          <div class="detail-grid">
            <div class="detail-card">
              <span class="detail-card__label">今日调用</span>
              <span class="detail-card__value">8,420</span>
            </div>
            <div class="detail-card">
              <span class="detail-card__label">成功率</span>
              <span class="detail-card__value">99.2%</span>
            </div>
          </div>
        </template>
        <template #activity>
          <ul class="activity-list">
            <li>用户 A 发布了新版本 v1.2</li>
            <li>自动备份已完成</li>
            <li>新增 2 位协作者</li>
          </ul>
        </template>
        <template #members>
          <p class="demo-text">3 位成员：管理员 1 · 编辑 2</p>
        </template>
        <template #settings>
          <p class="demo-text">应用可见性、API 限流与日志保留策略。</p>
        </template>
      </RsTabs>
    </DemoBlock>

    <DemoBlock title="设置页分栏（业务场景）">
      <p class="hint">账户设置常见布局：左侧或顶部标签 + 表单区域。</p>
      <div class="settings-layout">
        <RsTabs v-model="settingsTab" :items="settingsItems">
          <template #profile>
            <form class="settings-form" @submit.prevent>
              <label class="settings-form__field">
                <span>显示名称</span>
                <input type="text" value="弱水开发者" />
              </label>
              <label class="settings-form__field">
                <span>邮箱</span>
                <input type="email" value="dev@ruoshui.app" />
              </label>
              <RsButton size="sm" type="submit">保存</RsButton>
            </form>
          </template>
          <template #notifications>
            <p class="demo-text">邮件通知、站内提醒与 Webhook 推送偏好。</p>
          </template>
          <template #api>
            <p class="demo-text">创建与管理 API 密钥，查看调用配额。</p>
          </template>
        </RsTabs>
      </div>
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
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.meta {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.meta code {
  padding: 0.125rem 0.375rem;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-hover);
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  color: var(--rs-text);
}
.panel {
  margin: 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: var(--rs-line-height-normal);
}
.demo-text {
  margin: 0;
}
.panel--compact {
  padding: 0.5rem 0.75rem;
  font-size: var(--rs-font-size-xs);
}
.external-panel {
  margin-top: 0.75rem;
  padding: 1rem 1.25rem;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  font-size: var(--rs-font-size-sm);
}
.external-panel__desc {
  margin: 0.5rem 0 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}
.detail-header {
  margin-bottom: 0.75rem;
}
.detail-header__title {
  margin: 0;
  font-size: var(--rs-font-size-lg);
  font-weight: 600;
  color: var(--rs-text);
}
.detail-header__desc {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.75rem;
}
.detail-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}
.detail-card__label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.detail-card__value {
  font-size: var(--rs-font-size-lg);
  font-weight: 600;
  color: var(--rs-text);
  font-variant-numeric: tabular-nums;
}
.activity-list {
  margin: 0;
  padding: 0.75rem 1rem 0.75rem 1.75rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: 1.8;
}
.settings-layout {
  max-width: 28rem;
}
.narrow-tabs {
  max-width: 22rem;
  padding: 0.75rem;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}
.settings-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.settings-form__field input {
  min-height: var(--rs-control-height-md);
  padding: 0 0.75rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
}
</style>
