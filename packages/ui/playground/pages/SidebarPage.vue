<script setup lang="ts">
import { ref } from 'vue'
import {
  RsButton,
  RsSidebar,
  RsSidebarGroup,
  RsSidebarItem,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const collapsed = ref(false)
const activeNav = ref('dashboard')
const layoutCollapsed = ref(false)

const longNavItems = Array.from({ length: 16 }, (_, i) => ({
  key: `item-${i + 1}`,
  label: `菜单项 ${i + 1}`,
  icon: i % 3 === 0 ? 'folder' : i % 3 === 1 ? 'file-text' : 'settings',
}))
</script>

<template>
  <DemoPage title="RsSidebar" test-file="RsSidebar.spec.ts">
    <DemoBlock title="基础：标题与副标题">
      <p class="hint">默认 md 宽度，展示品牌区标题与副标题。</p>
      <div class="frame">
        <RsSidebar title="弱水 Studio" subtitle="组件实验室">
          <RsSidebarGroup title="示例">
            <RsSidebarItem label="概览" icon="layout-dashboard" active />
          </RsSidebarGroup>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="宽度档位">
      <p class="hint">sm / md / lg 三档固定宽度，适合不同信息密度。</p>
      <div class="width-row">
        <RsSidebar v-for="size in ['sm', 'md', 'lg']" :key="size" :title="size" :width="size">
          <RsSidebarGroup :title="`${size} 宽度`">
            <RsSidebarItem label="导航项" icon="box" />
          </RsSidebarGroup>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="可折叠">
      <p class="hint">
        开启 collapsible 后点击折叠按钮；子组件需通过默认插槽的 collapsed 参数同步折叠态。
      </p>
      <div class="frame frame--layout">
        <RsSidebar
          v-model:collapsed="collapsed"
          title="弱水"
          subtitle="SaaS 控制台"
          collapsible
        >
          <template #default="{ collapsed: isCollapsed }">
            <RsSidebarGroup title="工作区" :collapsed="isCollapsed">
              <RsSidebarItem
                label="仪表盘"
                icon="layout-dashboard"
                :active="activeNav === 'dashboard'"
                :collapsed="isCollapsed"
                @click="activeNav = 'dashboard'"
              />
              <RsSidebarItem
                label="项目"
                icon="folder"
                :active="activeNav === 'projects'"
                :collapsed="isCollapsed"
                @click="activeNav = 'projects'"
              />
              <RsSidebarItem
                label="设置"
                icon="settings"
                :active="activeNav === 'settings'"
                :collapsed="isCollapsed"
                @click="activeNav = 'settings'"
              />
            </RsSidebarGroup>
          </template>
        </RsSidebar>
        <div class="main-panel">
          <p class="main-panel__title">主内容区</p>
          <p class="meta">折叠状态：{{ collapsed ? '已折叠' : '展开' }} · 当前选中：{{ activeNav }}</p>
          <RsButton size="sm" variant="default" @click="collapsed = !collapsed">
            外部切换折叠
          </RsButton>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="分组导航">
      <p class="hint">多 RsSidebarGroup 组织模块；支持激活态与禁用项。</p>
      <div class="frame">
        <RsSidebar title="导航" subtitle="分组示例">
          <RsSidebarGroup title="产品">
            <RsSidebarItem label="仪表盘" icon="layout-dashboard" active />
            <RsSidebarItem label="分析" icon="bar-chart-3" />
            <RsSidebarItem label="即将上线" icon="sparkles" disabled />
          </RsSidebarGroup>
          <RsSidebarGroup title="账户">
            <RsSidebarItem label="成员" icon="users" />
            <RsSidebarItem label="账单" icon="credit-card" />
            <RsSidebarItem label="设置" icon="settings" />
          </RsSidebarGroup>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="自定义 header">
      <p class="hint">使用 header 插槽完全自定义顶栏，适合 Logo + 操作按钮组合。</p>
      <div class="frame">
        <RsSidebar>
          <template #header>
            <div class="custom-header">
              <span class="custom-header__logo">RS</span>
              <span class="custom-header__name">弱水设计系统</span>
            </div>
            <RsButton size="sm" variant="ghost">新建</RsButton>
          </template>
          <RsSidebarGroup title="快捷入口">
            <RsSidebarItem label="组件" icon="box" active />
            <RsSidebarItem label="主题" icon="palette" />
          </RsSidebarGroup>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="footer 插槽">
      <p class="hint">底栏适合放置用户信息、版本号或次要操作。</p>
      <div class="frame frame--tall">
        <RsSidebar title="弱水" collapsible v-model:collapsed="layoutCollapsed">
          <template #default="{ collapsed: isCollapsed }">
            <RsSidebarGroup title="导航" :collapsed="isCollapsed">
              <RsSidebarItem label="首页" icon="home" active :collapsed="isCollapsed" />
              <RsSidebarItem label="文档" icon="book-open" :collapsed="isCollapsed" />
            </RsSidebarGroup>
          </template>
          <template #footer="{ collapsed: isCollapsed }">
            <div v-if="!isCollapsed" class="footer-user">
              <span class="footer-user__avatar">U</span>
              <span class="footer-user__name">演示用户</span>
            </div>
            <span v-else class="footer-icon__dot" title="用户">U</span>
          </template>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="长列表滚动">
      <p class="hint">body 区域 overflow: auto，侧栏内容超出时内部滚动。</p>
      <div class="frame frame--scroll">
        <RsSidebar title="长导航" subtitle="16 项">
          <RsSidebarGroup title="全部菜单">
            <RsSidebarItem
              v-for="item in longNavItems"
              :key="item.key"
              :label="item.label"
              :icon="item.icon"
              :active="item.key === 'item-1'"
            />
          </RsSidebarGroup>
        </RsSidebar>
      </div>
    </DemoBlock>

    <DemoBlock title="应用布局">
      <p class="hint">典型 Studio / 后台布局：侧栏 + 顶栏 + 内容卡片。</p>
      <div class="app-shell">
        <RsSidebar
          v-model:collapsed="layoutCollapsed"
          title="弱水"
          collapsible
        >
          <template #default="{ collapsed: isCollapsed }">
            <RsSidebarGroup title="导航" :collapsed="isCollapsed">
              <RsSidebarItem
                label="仪表盘"
                icon="layout-dashboard"
                active
                :collapsed="isCollapsed"
              />
              <RsSidebarItem label="工作流" icon="workflow" :collapsed="isCollapsed" />
              <RsSidebarItem label="数据集" icon="database" :collapsed="isCollapsed" />
            </RsSidebarGroup>
            <RsSidebarGroup title="系统" :collapsed="isCollapsed">
              <RsSidebarItem label="设置" icon="settings" :collapsed="isCollapsed" />
            </RsSidebarGroup>
          </template>
        </RsSidebar>
        <div class="app-main">
          <header class="app-main__top">
            <h2 class="app-main__heading">仪表盘</h2>
          </header>
          <div class="app-main__content">
            <div class="stat-card">运行中任务 · 12</div>
            <div class="stat-card">待处理 · 5</div>
          </div>
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
  line-height: var(--rs-line-height-normal);
}

.meta {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.frame {
  display: inline-flex;
  max-width: 100%;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-bg);
  overflow: hidden;
}

.frame--layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  width: 100%;
}

.frame--tall :deep(.rs-sidebar) {
  min-height: 14rem;
}

.frame--scroll :deep(.rs-sidebar) {
  height: 12rem;
}

.width-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-md);
  align-items: flex-start;
}

.main-panel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-lg);
  min-width: 0;
}

.main-panel__title {
  margin: 0;
  font-size: var(--rs-font-size-md);
  font-weight: 600;
  color: var(--rs-text);
}

.custom-header {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.custom-header__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  font-size: var(--rs-font-size-xs);
  font-weight: 700;
}

.custom-header__name {
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-user {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.footer-user__avatar,
.footer-icon__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-full);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.footer-user__name {
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-shell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 16rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  overflow: hidden;
  background: var(--rs-bg);
}

.app-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-main__top {
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.app-main__heading {
  margin: 0;
  font-size: var(--rs-font-size-md);
  font-weight: 600;
  color: var(--rs-text);
}

.app-main__content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--rs-space-md);
  padding: var(--rs-space-lg);
}

.stat-card {
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
</style>
