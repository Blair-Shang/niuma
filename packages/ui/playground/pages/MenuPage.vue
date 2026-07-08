<script setup lang="ts">
import { ref } from 'vue'
import { RsMenu, type RsMenuItem, type RsMenuItemGroup } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const active = ref('projects')
const openKeys = ref<string[]>([])

const menuItems: RsMenuItem[] = [
  { key: 'dashboard', label: '仪表盘', icon: 'layout-dashboard' },
  {
    key: 'workspace',
    label: '工作区',
    icon: 'folder',
    children: [
      { key: 'projects', label: '项目' },
      { key: 'docs', label: '文档' },
      { key: 'archive', label: '归档', disabled: true },
    ],
  },
  { key: 'settings', label: '设置', icon: 'settings' },
]

const deepActive = ref('alpha-permissions')
const deepOpenKeys = ref<string[]>([])

const deepNestedItems: RsMenuItem[] = [
  { key: 'dashboard', label: '仪表盘', icon: 'layout-dashboard' },
  {
    key: 'workspace',
    label: '工作区',
    icon: 'folder',
    children: [
      {
        key: 'team-alpha',
        label: 'Alpha 团队',
        icon: 'users',
        children: [
          { key: 'alpha-projects', label: '项目列表' },
          { key: 'alpha-members', label: '成员管理' },
          {
            key: 'alpha-settings',
            label: '团队设置',
            children: [
              { key: 'alpha-general', label: '常规' },
              { key: 'alpha-permissions', label: '权限' },
              { key: 'alpha-audit', label: '审计日志', disabled: true },
            ],
          },
        ],
      },
      {
        key: 'team-beta',
        label: 'Beta 团队',
        children: [
          { key: 'beta-projects', label: '项目列表' },
          { key: 'beta-members', label: '成员管理' },
        ],
      },
    ],
  },
  {
    key: 'resources',
    label: '资源中心',
    icon: 'layers',
    children: [
      {
        key: 'templates',
        label: '模板库',
        children: [
          { key: 'tpl-design', label: '设计模板' },
          { key: 'tpl-dev', label: '开发模板' },
        ],
      },
      { key: 'marketplace', label: '应用市场' },
    ],
  },
  { key: 'settings', label: '设置', icon: 'settings' },
]

const groupedDeepActive = ref('saas-billing')
const groupedDeepOpenKeys = ref<string[]>([])

const groupedDeepItems: RsMenuItemGroup[] = [
  {
    label: '产品',
    children: [
      {
        key: 'product-line',
        label: '产品线',
        icon: 'box',
        children: [
          {
            key: 'saas',
            label: 'SaaS',
            children: [
              { key: 'saas-dashboard', label: '控制台' },
              { key: 'saas-billing', label: '计费' },
            ],
          },
          { key: 'enterprise', label: '企业版' },
        ],
      },
    ],
  },
  {
    label: '运营',
    children: [
      {
        key: 'analytics',
        label: '数据分析',
        icon: 'bar-chart-3',
        children: [
          { key: 'analytics-overview', label: '概览' },
          { key: 'analytics-funnel', label: '漏斗' },
        ],
      },
      { key: 'campaigns', label: '营销活动', icon: 'megaphone' },
    ],
  },
]

const collapsedActive = ref('projects')
const collapsedOpenKeys = ref<string[]>(['workspace'])

const groupedActive = ref('billing')
const groupedItems: RsMenuItemGroup[] = [
  {
    label: '工作区',
    children: [
      { key: 'apps', label: '应用', icon: 'layout-dashboard' },
      { key: 'chat', label: '对话', icon: 'message-square' },
    ],
  },
  {
    label: '账户',
    children: [
      { key: 'billing', label: '账单', icon: 'credit-card' },
      { key: 'security', label: '安全', icon: 'shield-check' },
    ],
  },
]

const horizontalNestedActive = ref('share-email')
const horizontalNestedOpenKeys = ref<string[]>([])

const horizontalNestedItems: RsMenuItem[] = [
  { key: 'home', label: '首页', icon: 'layout-dashboard' },
  {
    key: 'workspace',
    label: '工作区',
    icon: 'folder',
    children: [
      { key: 'projects', label: '项目' },
      {
        key: 'share',
        label: '分享',
        icon: 'share-2',
        children: [
          { key: 'share-slack', label: 'Slack' },
          { key: 'share-email', label: '邮件' },
          { key: 'share-link', label: '复制链接' },
        ],
      },
    ],
  },
  { key: 'settings', label: '设置', icon: 'settings' },
]
</script>

<template>
  <DemoPage title="RsMenu" test-file="RsMenu.spec.ts">
    <DemoBlock title="单层嵌套">
      <div class="menu-frame">
        <RsMenu
          v-model="active"
          v-model:open-keys="openKeys"
          :items="menuItems"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="多层嵌套（4 级）">
      <p class="menu-hint">
        选中项：<code>{{ deepActive }}</code>
        · 展开：<code>{{ deepOpenKeys.join(', ') || '—' }}</code>
      </p>
      <div class="menu-frame menu-frame--tall">
        <RsMenu
          v-model="deepActive"
          v-model:open-keys="deepOpenKeys"
          :items="deepNestedItems"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="分组 + 多层嵌套">
      <div class="menu-frame menu-frame--tall">
        <RsMenu
          v-model="groupedDeepActive"
          v-model:open-keys="groupedDeepOpenKeys"
          :items="groupedDeepItems"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="收起态（仅图标）">
      <div class="menu-frame menu-frame--collapsed">
        <RsMenu
          v-model="collapsedActive"
          v-model:open-keys="collapsedOpenKeys"
          :items="menuItems"
          collapsed
        />
      </div>
    </DemoBlock>

    <DemoBlock title="分组菜单（水平）">
      <div class="menu-frame menu-frame--wide">
        <RsMenu v-model="groupedActive" :items="groupedItems" mode="horizontal" />
      </div>
    </DemoBlock>

    <DemoBlock title="水平 + 嵌套子菜单">
      <div class="menu-frame menu-frame--wide">
        <RsMenu
          v-model="horizontalNestedActive"
          v-model:open-keys="horizontalNestedOpenKeys"
          :items="horizontalNestedItems"
          mode="horizontal"
        />
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.menu-frame {
  width: 14rem;
  padding: 0.5rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
}
.menu-frame--wide {
  width: 100%;
}
.menu-frame--tall {
  width: 16rem;
}
.menu-frame--collapsed {
  width: 3rem;
  padding: 0.5rem 0.25rem;
}
.menu-hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.menu-hint code {
  padding: 0.125rem 0.375rem;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-hover);
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  color: var(--rs-text);
}
</style>
