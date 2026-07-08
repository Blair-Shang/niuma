<script setup lang="ts">
/**
 * 编辑区（工作区）。支持 **多编辑组分屏**（VS Code editor groups）：
 * 横向并排渲染每个编辑组，**每组各一条 TabBar + 一个 `<keep-alive>`**，按 tabId
 * 为组内每个 Tab 保活独立实例。组间可拖分隔条调整宽度比例；点击某组任意处将其设为
 * 激活组。
 *
 * 设置页与模块一样是**编辑器 Tab**（内置视图，`internal-views.ts`），随普通 Tab 一起
 * 渲染/保活/关闭/分屏，不再是整页覆盖层——对齐 VS Code 打开设置的行为。
 *
 * 路由只反映「全局激活 Tab（激活组的激活 Tab）属于哪个模块」，与侧栏/活动栏高亮、
 * 深链、前进后退保持一致；内置视图 Tab（如设置）无模块路由，不驱动 URL。
 *
 * @see docs/09-web-app-shell.md 第 6 节「Tab 工作区」
 */
import { RsIcon } from '@niuma/ui'
import { computed, defineAsyncComponent, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { resolveModuleComponent } from '@/extensions/host/resolve-module'
import { getModuleById, getModuleByRoutePath } from '@/extensions/registry/extension-registry'
import { getInternalView } from '@/shell/internal-views'
import { useTabStore, type EditorGroup, type WorkspaceTab } from '@/stores/tab'
import TabBar from '../bars/TabBar.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const tabStore = useTabStore()

/** 分屏拖拽的最小组宽（px） */
const MIN_GROUP_WIDTH = 200

/** 内置视图组件缓存：稳定的 async 组件标识，保证 keep-alive 生效 */
const internalComponents = new Map<string, Component>()

/** 解析内置视图 id 对应组件（记忆化） */
function internalComponent(id: string): Component | null {
  const cached = internalComponents.get(id)
  if (cached) {
    return cached
  }
  const view = getInternalView(id)
  if (!view) {
    return null
  }
  const comp = defineAsyncComponent(view.load)
  internalComponents.set(id, comp)
  return comp
}

/** 某编辑组的激活 Tab */
function groupActiveTab(group: EditorGroup): WorkspaceTab | null {
  return group.tabs.find((t) => t.tabId === group.activeTabId) ?? null
}

/** 某编辑组激活 Tab 对应的可渲染组件（内置视图优先，否则模块组件；均记忆化） */
function groupComponent(group: EditorGroup): Component | null {
  const tab = groupActiveTab(group)
  if (!tab) {
    return null
  }
  return internalComponent(tab.moduleId) ?? resolveModuleComponent(tab.moduleId)
}

/**
 * 预计算每组的激活 Tab 与组件，避免模板内对同一 group 多次调用 groupComponent /
 * groupActiveTab（双重调用会导致两次 resolveModuleComponent 执行）。
 */
const groupMetas = computed(() =>
  tabStore.groups.map((group) => {
    const activeTab = groupActiveTab(group)
    const component = activeTab
      ? (internalComponent(activeTab.moduleId) ?? resolveModuleComponent(activeTab.moduleId))
      : null
    return { group, activeTab, component }
  }),
)

/**
 * 拖拽组间分隔条调整两侧宽度比例（仅影响相邻两组，其余组不变）。
 *
 * @param index - 左侧组在 groups 中的下标（分隔条位于 index 与 index+1 之间）
 * @param event - pointerdown 事件
 */
function startResize(index: number, event: PointerEvent): void {
  const left = tabStore.groups[index]
  const right = tabStore.groups[index + 1]
  if (!left || !right) {
    return
  }
  const resizer = event.currentTarget as HTMLElement
  const leftEl = resizer.previousElementSibling as HTMLElement | null
  const rightEl = resizer.nextElementSibling as HTMLElement | null
  if (!leftEl || !rightEl) {
    return
  }
  const leftW0 = leftEl.getBoundingClientRect().width
  const rightW0 = rightEl.getBoundingClientRect().width
  const pairW = leftW0 + rightW0
  const sumGrow = left.grow + right.grow
  const startX = event.clientX
  event.preventDefault()
  document.body.style.cursor = 'col-resize'

  function onMove(e: PointerEvent): void {
    const dx = e.clientX - startX
    const newLeftW = Math.max(MIN_GROUP_WIDTH, Math.min(leftW0 + dx, pairW - MIN_GROUP_WIDTH))
    const leftGrow = (sumGrow * newLeftW) / pairW
    tabStore.resizeGroups(left.groupId, leftGrow, right.groupId, sumGrow - leftGrow)
  }
  function onUp(): void {
    globalThis.removeEventListener('pointermove', onMove)
    globalThis.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
  }
  globalThis.addEventListener('pointermove', onMove)
  globalThis.addEventListener('pointerup', onUp)
}

// 首次同步标记：区分「初始加载（可能已从持久化恢复 Tab）」与后续导航
let initialSync = true

// 路由 → Tab：仅聚焦已存在的同模块 Tab，不因路由变化自动新建「模块首页」Tab。
// 编辑器 Tab 由连接/新建会话（openTab）或命令面板等显式入口创建。
watch(
  () => route.path,
  (path) => {
    const mod = getModuleByRoutePath(path)
    if (!mod || tabStore.activeTab?.moduleId === mod.id) {
      initialSync = false
      return
    }
    // 初始加载且已从持久化恢复出 Tab：以恢复的激活 Tab 为准，把 URL 切到它，
    // 而不是用 redirect 的默认模块（如 /ssh）覆盖上次会话。
    if (initialSync && tabStore.activeTab) {
      initialSync = false
      const active = getModuleById(tabStore.activeTab.moduleId)
      if (active && route.path !== active.routePath) {
        router.replace(active.routePath).catch(() => undefined)
      }
      return
    }
    initialSync = false
    const existing = tabStore.allTabs.find((tab) => tab.moduleId === mod.id)
    if (existing) {
      tabStore.activateTab(existing.tabId)
    }
  },
  { immediate: true },
)

// Tab → 路由：激活 Tab 的模块变化时把 URL 切到该模块路由（驱动高亮/深链）。
// 仅当路由不同才 push，避免与上面的 watch 形成回环。
watch(
  () => tabStore.activeTab?.moduleId,
  (moduleId) => {
    if (!moduleId) {
      return
    }
    const mod = getModuleById(moduleId)
    if (mod && route.path !== mod.routePath) {
      router.push(mod.routePath).catch(() => undefined)
    }
  },
)
</script>

<template>
  <main class="nm-workspace">
    <!-- 工具工作区（常驻）：多编辑组分屏，每组各一条 TabBar + keep-alive -->
    <div v-show="tabStore.allTabs.length" class="nm-groups">
      <template v-for="({ group, activeTab, component }, i) in groupMetas" :key="group.groupId">
        <section
          class="nm-group"
          :style="{ flexGrow: group.grow }"
          @mousedown="tabStore.setActiveGroup(group.groupId)"
        >
          <TabBar :group-id="group.groupId" />
          <div class="nm-group__body">
            <keep-alive>
              <component
                :is="component"
                v-if="component && activeTab"
                :key="activeTab.tabId"
                class="nm-workspace-view"
                v-bind="activeTab.props"
              />
            </keep-alive>
          </div>
        </section>
        <div
          v-if="i < tabStore.groups.length - 1"
          class="nm-group__resizer"
          aria-hidden="true"
          @pointerdown="startResize(i, $event)"
        />
      </template>
    </div>

    <div v-show="!tabStore.allTabs.length" class="nm-workspace-empty">
      <RsIcon name="layout-dashboard" :size="40" class="nm-workspace-empty__icon" />
      <p class="nm-section-title">{{ t('workspace.emptyTitle') }}</p>
      <p class="nm-section-desc">{{ t('workspace.emptyDesc') }}</p>
    </div>
  </main>
</template>

<style scoped>
.nm-workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.nm-groups {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.nm-group {
  display: flex;
  flex-direction: column;
  flex-basis: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.nm-group__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--nm-editor-bg);
}

.nm-workspace-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}

/* 组间分隔条：1px 视觉线 + 更宽的透明命中区 */
.nm-group__resizer {
  position: relative;
  flex: 0 0 1px;
  width: 1px;
  background: var(--rs-border-subtle);
  cursor: col-resize;
}

.nm-group__resizer::before {
  content: '';
  position: absolute;
  inset: 0 -3px;
  z-index: 2;
}

.nm-group__resizer:hover {
  background: var(--rs-primary);
}

.nm-workspace-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-lg);
  text-align: center;
  color: var(--rs-muted);
}

.nm-workspace-empty__icon {
  margin-bottom: var(--rs-space-sm);
  color: var(--rs-placeholder);
}
</style>
