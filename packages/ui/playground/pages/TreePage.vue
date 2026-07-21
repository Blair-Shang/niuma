<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  RsBadge,
  RsButton,
  RsContextMenu,
  RsInput,
  RsTree,
  type RsContextMenuItem,
  type RsTreeDropPosition,
  type RsTreeNode,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicValue = ref('flows')
const multiValue = ref<string[]>(['datasets'])
const strictCheckedKeys = ref<string[]>(['child-a'])
const onlyLeafCheckedKeys = ref<string[]>(['child-a'])
const disabledSelect = ref('')
const navigatorValue = ref('design-ui')
const emptyFilter = ref('找不到的内容')
const customFilterText = ref('api')
const lastEvent = ref('（未触发）')

const basicNodes: RsTreeNode[] = [
  {
    key: 'workspace',
    label: '工作区',
    icon: 'folder',
    children: [
      {
        key: 'flows',
        label: '流程',
        icon: 'workflow',
        children: [
          { key: 'flow-1', label: '数据同步', icon: 'file' },
          { key: 'flow-2', label: '质量检查', icon: 'file' },
        ],
      },
      { key: 'datasets', label: '数据集', icon: 'database' },
    ],
  },
  { key: 'settings', label: '设置', icon: 'settings' },
]

const expandedKeys = ref(['workspace', 'flows'])
const checkedKeys = ref<string[]>(['read', 'write'])
const halfCheckedKeys = ref<string[]>([])
const filterText = ref('Tree')
const highlightDemoFilter = ref('flow')
const treeRef = ref<InstanceType<typeof RsTree> | null>(null)
const keyboardTreeRef = ref<InstanceType<typeof RsTree> | null>(null)
const lastDrop = ref('')

const ctxTestLog = ref<string[]>([])
const ctxConnNodes: RsTreeNode[] = [
  {
    key: 'folder-dev',
    label: '开发环境',
    icon: 'folder',
    children: [
      { key: 'conn-local', label: '本地 MongoDB', icon: 'database' },
      { key: 'conn-staging', label: 'Staging Redis', icon: 'database' },
    ],
  },
  { key: 'conn-prod', label: '生产只读', icon: 'database' },
]

const rootCtxItems: RsContextMenuItem[] = [
  { key: 'new-conn', label: '新建连接', icon: 'plus' },
  { key: 'new-folder', label: '新建文件夹', icon: 'folder-plus' },
  { key: 'refresh', label: '刷新', icon: 'refresh-cw' },
]

const folderCtxItems: RsContextMenuItem[] = [
  { key: 'new-conn', label: '在此文件夹新建', icon: 'plus' },
  { key: 'rename', label: '重命名', icon: 'pen-line' },
  { key: 'delete', label: '删除文件夹', icon: 'trash-2', danger: true },
]

const connCtxItems: RsContextMenuItem[] = [
  { key: 'connect', label: '连接', icon: 'plug' },
  { key: 'edit', label: '编辑', icon: 'pen-line' },
  { key: 'delete', label: '删除', icon: 'trash-2', danger: true },
]

function logCtx(source: string, key: string): void {
  ctxTestLog.value = [`${source} → ${key}`, ...ctxTestLog.value].slice(0, 6)
}

function onRootCtx(key: string): void {
  logCtx('空白区域', key)
}

function onFolderCtx(key: string, label: string): void {
  logCtx(`文件夹「${label}」`, key)
}

function onConnCtx(key: string, label: string): void {
  logCtx(`连接「${label}」`, key)
}

function isFolderNode(node: RsTreeNode): boolean {
  return Array.isArray(node.children) && node.children.length > 0
}

const apiNodes = ref([
  {
    id: 'dept-1',
    name: '研发中心',
    subList: [
      { id: 'dept-1-1', name: '前端组' },
      { id: 'dept-1-2', name: '后端组' },
    ],
  },
])

const permissionNodes: RsTreeNode[] = [
  {
    key: 'project',
    label: '项目权限',
    icon: 'shield',
    children: [
      { key: 'read', label: '查看', icon: 'eye' },
      { key: 'write', label: '编辑', icon: 'pencil' },
      { key: 'admin', label: '管理', icon: 'lock', disabled: true },
    ],
  },
]

const strictNodes: RsTreeNode[] = [
  {
    key: 'group',
    label: '权限组',
    children: [
      { key: 'child-a', label: '子权限 A' },
      { key: 'child-b', label: '子权限 B' },
    ],
  },
]

const disabledNodes: RsTreeNode[] = [
  {
    key: 'org',
    label: '组织',
    children: [
      { key: 'team-a', label: '团队 A' },
      { key: 'team-b', label: '团队 B（已归档）', disabled: true },
      {
        key: 'team-c',
        label: '团队 C（禁勾选）',
        disableCheckbox: true,
      },
    ],
  },
]

const fileNodes: RsTreeNode[] = [
  {
    key: 'src',
    label: 'src',
    icon: 'folder',
    children: [
      {
        key: 'components',
        label: 'components',
        icon: 'folder',
        children: [
          { key: 'RsTree.vue', label: 'RsTree.vue', icon: 'file-code' },
          { key: 'RsTable.vue', label: 'RsTable.vue', icon: 'file-code' },
        ],
      },
      { key: 'index.ts', label: 'index.ts', icon: 'file-code' },
    ],
  },
]

const customFilterNodes: RsTreeNode[] = [
  {
    key: 'docs',
    label: '用户文档',
    children: [
      { key: 'guide', label: '快速上手' },
      { key: 'rest-api', label: 'REST API' },
      { key: 'graphql-api', label: 'GraphQL API' },
    ],
  },
  { key: 'changelog', label: '更新日志' },
]

const navigatorNodes: RsTreeNode[] = [
  {
    key: 'design',
    label: '设计',
    children: [
      { key: 'design-ui', label: 'UI 稿' },
      { key: 'design-proto', label: '原型' },
    ],
  },
  {
    key: 'dev',
    label: '开发',
    children: [
      { key: 'dev-fe', label: '前端' },
      { key: 'dev-be', label: '后端' },
    ],
  },
]

const statusNodes: RsTreeNode[] = [
  {
    key: 'svc-a',
    label: '订单服务',
    children: [
      { key: 'svc-a-1', label: '实例 1', status: 'running' },
      { key: 'svc-a-2', label: '实例 2', status: 'stopped' },
    ],
  },
  { key: 'svc-b', label: '支付服务', status: 'running' },
]

const lazyNodes = ref<RsTreeNode[]>([
  { key: 'async-root', label: '异步目录', isLeaf: false },
])

const leafNodes: RsTreeNode[] = [
  {
    key: 'folder',
    label: '文件夹（有子节点）',
    children: [{ key: 'child', label: '子文件' }],
  },
  { key: 'leaf-flag', label: '标记 isLeaf 的节点', isLeaf: true },
]

const dragNodes = ref<RsTreeNode[]>([
  { key: 'alpha', label: 'Alpha' },
  { key: 'beta', label: 'Beta' },
  { key: 'gamma', label: 'Gamma' },
])

function createLargeTree(): RsTreeNode[] {
  return Array.from({ length: 8 }, (_, section) => ({
    key: `section-${section}`,
    label: `分组 ${section + 1}`,
    icon: 'folder',
    children: Array.from({ length: 40 }, (_, index) => ({
      key: `section-${section}-item-${index}`,
      label: `节点 ${section + 1}-${String(index + 1).padStart(2, '0')}`,
      icon: 'file',
    })),
  }))
}

const largeNodes = createLargeTree()
const largeExpanded = ref(largeNodes.map((node) => String(node.key)))

const flatLargeNodes = computed(() =>
  Array.from({ length: 150 }, (_, index) => ({
    key: `flat-${index}`,
    label: `平铺节点 ${String(index + 1).padStart(3, '0')}`,
  })),
)

const lastCheck = ref('')

async function loadLazyChildren(_node: RsTreeNode, key: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (key !== 'async-root') return
  lazyNodes.value = [
    {
      key: 'async-root',
      label: '异步目录',
      children: [
        { key: 'async-1', label: '延迟加载子节点 A', icon: 'file' },
        { key: 'async-2', label: '延迟加载子节点 B', icon: 'file' },
      ],
    },
  ]
}

function customFilterNode(node: RsTreeNode, keyword: string): boolean {
  return String(node.label ?? '').toLowerCase().includes('api')
    || keyword.toLowerCase() === 'api' && String(node.key).includes('api')
}

function onCheck(keys: string[], half: string[]): void {
  lastCheck.value = `checked: ${keys.length} · half: ${half.join(', ') || '无'}`
}

function onNodeDrop(dragKey: string, dropKey: string, position: string): void {
  lastDrop.value = `${dragKey} → ${dropKey} (${position})`
}

function onNodeClick(node: RsTreeNode, key: string): void {
  lastEvent.value = `node-click: ${String(node.label ?? key)}`
}

function onExpand(key: string, expanded: boolean): void {
  lastEvent.value = `expand: ${key} → ${expanded ? '展开' : '收起'}`
}

function allowDrop(dragKey: string, dropKey: string, position: RsTreeDropPosition): boolean {
  if (position === 'inside' && dropKey === 'gamma') return false
  return dragKey !== dropKey
}

function statusLabel(status: unknown): string {
  return status === 'running' ? '运行中' : '已停止'
}

function statusVariant(status: unknown): 'success' | 'default' {
  return status === 'running' ? 'success' : 'default'
}
</script>

<template>
  <DemoPage title="RsTree" test-file="RsTree.spec.ts / tree-utils.spec.ts">
    <DemoBlock title="选中行高亮">
      <p class="hint">
        选中节点整行背景高亮（<code>rs-tree__row--selected</code>）；多选模式下可同时高亮多行。
      </p>
      <div class="split">
        <div class="split__col">
          <p class="split__label">单选</p>
          <RsTree v-model="basicValue" :nodes="fileNodes" block-node show-line default-expand-all />
          <p class="meta">选中：<code>{{ basicValue }}</code></p>
        </div>
        <div class="split__col">
          <p class="split__label">多选 multiple</p>
          <RsTree v-model="multiValue" :nodes="basicNodes" multiple block-node default-expand-all />
          <p class="meta">已选：<code>{{ multiValue.join(', ') || '无' }}</code></p>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="基础用法">
      <p class="hint">
        点击 <code>›</code> 展开/收起；点击节点选中。支持 <code>icon</code> 与
        <code>default-expand-all</code>。
      </p>
      <RsTree v-model="basicValue" :nodes="basicNodes" default-expand-all />
      <p class="meta">当前选中：<code>{{ basicValue || '（未选择）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="多选 multiple">
      <p class="hint"><code>multiple</code> 开启后 <code>v-model</code> 为 <code>string[]</code>，可多项高亮。</p>
      <RsTree v-model="multiValue" :nodes="basicNodes" multiple default-expand-all />
      <p class="meta">已选：<code>{{ multiValue.join(', ') || '（无）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="尺寸 size">
      <p class="hint">
        <code>sm</code> 行高 28px · 适合紧凑侧边栏；
        <code>md</code>（默认）行高 34px · 通用场景；
        <code>lg</code> 行高 40px · 适合触控或宽松布局。
      </p>
      <div class="size-grid">
        <div class="size-col">
          <p class="size-label">sm · 紧凑 · 行高 28px</p>
          <RsTree :nodes="fileNodes" size="sm" default-expand-all show-line />
        </div>
        <div class="size-col">
          <p class="size-label">md · 默认 · 行高 34px</p>
          <RsTree :nodes="fileNodes" size="md" default-expand-all show-line />
        </div>
        <div class="size-col">
          <p class="size-label">lg · 宽松 · 行高 40px</p>
          <RsTree :nodes="fileNodes" size="lg" default-expand-all show-line />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="fieldNames 字段映射">
      <p class="hint">对齐 Ant <code>fieldNames</code> / Element <code>props</code>，直接消费后端字段。</p>
      <RsTree
        :nodes="apiNodes"
        :field-names="{ key: 'id', label: 'name', children: 'subList' }"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="可勾选 checkable">
      <p class="hint"><code>checkable</code> 父子联动；<code>v-model:checked-keys</code> 与半选态同步。</p>
      <RsTree
        v-model:checked-keys="checkedKeys"
        v-model:half-checked-keys="halfCheckedKeys"
        :nodes="permissionNodes"
        checkable
        default-expand-all
        @check="onCheck"
      />
      <p class="meta">checked: <code>{{ checkedKeys.join(', ') }}</code></p>
      <p class="meta">halfChecked: <code>{{ halfCheckedKeys.join(', ') || '无' }}</code></p>
      <p v-if="lastCheck" class="meta">{{ lastCheck }}</p>
    </DemoBlock>

    <DemoBlock title="严格勾选 checkStrictly">
      <p class="hint"><code>check-strictly</code> 父子勾选互不影响。</p>
      <RsTree
        v-model:checked-keys="strictCheckedKeys"
        :nodes="strictNodes"
        checkable
        check-strictly
        default-expand-all
      />
      <p class="meta">checked: <code>{{ strictCheckedKeys.join(', ') }}</code></p>
    </DemoBlock>

    <DemoBlock title="仅叶子可勾选 onlyCheckLeaf">
      <p class="hint">
        <code>only-check-leaf</code> 仅叶子节点显示勾选框；父节点根据子节点显示全选/半选态，对齐 Ant Design。
      </p>
      <RsTree
        v-model:checked-keys="onlyLeafCheckedKeys"
        :nodes="strictNodes"
        checkable
        only-check-leaf
        default-expand-all
      />
      <p class="meta">checked（仅叶子）：<code>{{ onlyLeafCheckedKeys.join(', ') || '无' }}</code></p>
    </DemoBlock>

    <DemoBlock title="受控展开 expandedKeys">
      <RsTree
        v-model="basicValue"
        v-model:expanded-keys="expandedKeys"
        :nodes="basicNodes"
      />
      <p class="meta">expandedKeys: <code>{{ expandedKeys.join(', ') || '（无）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="禁用节点 disabled / disableCheckbox">
      <p class="hint">
        <code>disabled</code> 不可选中；<code>disableCheckbox</code> 仅禁止勾选。
      </p>
      <RsTree
        v-model="disabledSelect"
        v-model:checked-keys="checkedKeys"
        :nodes="disabledNodes"
        checkable
        default-expand-all
      />
      <p class="meta">选中：<code>{{ disabledSelect || '（无）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="isLeaf 强制叶子">
      <p class="hint">即使无 <code>children</code>，<code>isLeaf: true</code> 也不显示展开按钮。</p>
      <RsTree :nodes="leafNodes" default-expand-all />
    </DemoBlock>

    <DemoBlock title="搜索过滤 filter + 关键词高亮">
      <p class="hint">
        <code>filter</code> 过滤节点；<code>highlight</code>（默认开启）对匹配片段加
        <code>mark.rs-tree__highlight</code> 标记。
      </p>
      <RsInput v-model="highlightDemoFilter" placeholder="按 label 搜索…" />
      <RsTree
        v-model="basicValue"
        :nodes="fileNodes"
        :filter="highlightDemoFilter"
        block-node
        expand-on-click-node
        show-line
      />
    </DemoBlock>

    <DemoBlock title="关闭关键词高亮 highlight=false">
      <p class="hint">设置 <code>:highlight="false"</code> 时仅过滤，不高亮匹配文字。</p>
      <RsInput v-model="filterText" placeholder="按 label 搜索…" />
      <RsTree
        v-model="basicValue"
        :nodes="fileNodes"
        :filter="filterText"
        :highlight="false"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="自定义 filterNode">
      <p class="hint"><code>filter-node</code> 自定义匹配逻辑（本例仅匹配 label 含 api 的节点）。</p>
      <RsInput v-model="customFilterText" placeholder="输入 api 试试…" />
      <RsTree
        :nodes="customFilterNodes"
        :filter="customFilterText"
        :filter-node="customFilterNode"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="空状态">
      <p class="hint">过滤无结果时展示 <code>RsEmpty</code>。</p>
      <RsTree :nodes="basicNodes" :filter="emptyFilter" />
    </DemoBlock>

    <DemoBlock title="checkOnClickNode">
      <p class="hint">点击节点行即可勾选，无需点复选框。</p>
      <RsTree
        v-model:checked-keys="checkedKeys"
        :nodes="permissionNodes"
        checkable
        check-on-click-node
        :selectable="false"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="事件 node-click / expand">
      <RsTree
        :nodes="fileNodes"
        default-expand-all
        @node-click="onNodeClick"
        @expand="onExpand"
      />
      <p class="meta">最近事件：<code>{{ lastEvent }}</code></p>
    </DemoBlock>

    <DemoBlock title="#title 插槽自定义节点">
      <p class="hint">通过 <code>#title</code> 渲染徽章、状态等自定义内容。</p>
      <RsTree :nodes="statusNodes" default-expand-all>
        <template #title="{ node, label }">
          <span class="title-slot">
            <span>{{ label }}</span>
            <RsBadge
              v-if="node.status"
              :variant="statusVariant(node.status)"
            >
              {{ statusLabel(node.status) }}
            </RsBadge>
          </span>
        </template>
      </RsTree>
    </DemoBlock>

    <DemoBlock title="键盘导航与聚焦高亮">
      <p class="hint">
        点击下方按钮聚焦树后，使用 <code>↑↓←→</code>、<code>Home/End</code>、<code>Enter/Space</code> 操作；
        当前聚焦行显示 <code>rs-tree__row--focused</code> 描边。
      </p>
      <RsButton size="sm" variant="default" @click="keyboardTreeRef?.focusNode('flows')">
        聚焦「流程」节点
      </RsButton>
      <RsTree
        ref="keyboardTreeRef"
        v-model="basicValue"
        :nodes="basicNodes"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="懒加载 loadData">
      <p class="hint"><code>lazy</code> + <code>load-data</code>：展开时异步拉取，按钮显示 loading。</p>
      <RsTree :nodes="lazyNodes" lazy :load-data="loadLazyChildren" />
    </DemoBlock>

    <DemoBlock title="手风琴 accordion">
      <p class="hint">同级仅展开一个分支。</p>
      <RsTree :nodes="basicNodes" accordion />
    </DemoBlock>

    <DemoBlock title="拖拽 draggable + allowDrop">
      <p class="hint">
        <code>draggable</code> 拖拽排序；<code>allow-drop</code> 禁止拖入 Gamma（inside）。
        <code>drag-trigger="row"</code> 不显示拖拽手柄，整行按住拖动。
      </p>
      <RsTree
        :nodes="dragNodes"
        draggable
        drag-trigger="row"
        :allow-drop="allowDrop"
        @node-drop="onNodeDrop"
      />
      <p v-if="lastDrop" class="meta">最近拖放：<code>{{ lastDrop }}</code></p>
    </DemoBlock>

    <DemoBlock title="虚拟滚动 virtual">
      <p class="hint">显式 <code>virtual</code> + <code>height</code>，或超过 <code>virtual-threshold</code> 自动启用。</p>
      <div class="split">
        <div class="split__col">
          <p class="split__label">显式 virtual（层级树）</p>
          <RsTree
            v-model="basicValue"
            v-model:expanded-keys="largeExpanded"
            :nodes="largeNodes"
            virtual
            :height="240"
          />
        </div>
        <div class="split__col">
          <p class="split__label">自动 virtual-threshold（150 项平铺）</p>
          <RsTree :nodes="flatLargeNodes" :height="240" />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="暴露方法 expandAll / collapseAll">
      <div class="row">
        <RsButton size="sm" variant="default" @click="treeRef?.expandAll()">全部展开</RsButton>
        <RsButton size="sm" variant="default" @click="treeRef?.collapseAll()">全部收起</RsButton>
      </div>
      <RsTree ref="treeRef" v-model="basicValue" :nodes="fileNodes" show-line />
    </DemoBlock>

    <DemoBlock title="场景：侧边资源导航">
      <p class="hint">窄栏 + <code>block-node</code> 整行可点，适合模块切换。</p>
      <div class="navigator">
        <p class="navigator__title">资源目录</p>
        <RsTree
          v-model="navigatorValue"
          :nodes="navigatorNodes"
          block-node
          default-expand-all
          show-line
        />
      </div>
      <p class="meta">当前模块：<code>{{ navigatorValue }}</code></p>
    </DemoBlock>

    <DemoBlock title="expandOnClickNode 点击展开">
      <p class="hint"><code>expand-on-click-node</code> 点击节点文字即可展开/收起，无需点小三角。</p>
      <RsTree
        v-model="basicValue"
        :nodes="basicNodes"
        expand-on-click-node
        :selectable="false"
        default-expand-all
      />
    </DemoBlock>

    <DemoBlock title="showLine 连接线">
      <p class="hint"><code>show-line</code> 展示层级连接线，适合文件树、目录树。</p>
      <RsTree v-model="basicValue" :nodes="fileNodes" show-line default-expand-all />
    </DemoBlock>

    <DemoBlock title="blockNode 整行点击">
      <p class="hint"><code>block-node</code> 整行区域可点击选中，配合 <code>show-line</code> 使用。</p>
      <RsTree v-model="basicValue" :nodes="fileNodes" block-node show-line default-expand-all />
    </DemoBlock>

    <DemoBlock title="场景：角色权限分配（仅叶子）">
      <div class="panel">
        <p class="panel__label">菜单权限 · onlyCheckLeaf</p>
        <RsTree
          v-model:checked-keys="onlyLeafCheckedKeys"
          :nodes="permissionNodes"
          checkable
          only-check-leaf
          default-expand-all
        />
        <p class="panel__summary">
          已选叶子权限：<code>{{ onlyLeafCheckedKeys.join(', ') || '无' }}</code>
        </p>
      </div>
    </DemoBlock>

    <DemoBlock title="场景：角色权限分配">
      <div class="panel">
        <p class="panel__label">为角色勾选权限</p>
        <RsTree
          v-model:checked-keys="checkedKeys"
          :nodes="permissionNodes"
          checkable
          default-expand-all
        />
        <p class="panel__summary">
          将授予 <strong>{{ checkedKeys.length }}</strong> 项权限
        </p>
      </div>
    </DemoBlock>

    <DemoBlock title="🔬 连接树右键（空白区域 + 节点）">
      <p class="hint">
        模拟侧栏连接树：<code>RsContextMenu</code> 包裹整棵树作为根菜单，节点在
        <code>#title</code> 插槽内嵌套各自菜单。树置于固定高度容器（<code>virtual</code> +
        <code>height</code>），在节点列表<strong>下方空白处</strong>右键应弹出根菜单（新建连接 / 文件夹）；
        在节点上右键弹出对应菜单。节点菜单已 <code>@contextmenu.stop</code>，不会冒泡到根菜单。
      </p>
      <RsContextMenu :items="rootCtxItems" @select="onRootCtx">
        <div class="ctx-tree-host">
          <RsTree
            :nodes="ctxConnNodes"
            :height="220"
            virtual
            block-node
            show-line
            default-expand-all
            :selectable="false"
            size="sm"
          >
            <template #title="{ node, label }">
              <RsContextMenu
                v-if="isFolderNode(node)"
                :items="folderCtxItems"
                @select="onFolderCtx($event, label)"
              >
                <span class="ctx-tree-node">{{ label }}</span>
              </RsContextMenu>
              <RsContextMenu
                v-else
                :items="connCtxItems"
                @select="onConnCtx($event, label)"
              >
                <span class="ctx-tree-node">{{ label }}</span>
              </RsContextMenu>
            </template>
          </RsTree>
        </div>
      </RsContextMenu>
      <div class="ctx-test-log">
        <div v-if="!ctxTestLog.length" class="ctx-test-log__empty">在树上右键试试</div>
        <div v-for="(line, i) in ctxTestLog" :key="i">{{ line }}</div>
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
  color: var(--rs-text);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--rs-space-lg);
}
.split__label {
  margin: 0 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}
.title-slot {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.navigator {
  max-width: 14rem;
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg);
}
.navigator__title {
  margin: 0 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  letter-spacing: 0.02em;
}
.panel {
  max-width: 18rem;
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg);
}
.panel__label {
  margin: 0 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.panel__summary {
  margin: var(--rs-space-sm) 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.panel__summary strong {
  color: var(--rs-primary);
  font-weight: 600;
}
.size-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--rs-space-lg);
}
.size-col {
  min-width: 0;
}
.size-label {
  margin: 0 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}
.ctx-tree-host {
  height: 220px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
  background: var(--rs-bg);
}
.ctx-tree-node {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-test-log {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-subtle);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.6;
}
.ctx-test-log__empty {
  font-style: italic;
}
</style>
