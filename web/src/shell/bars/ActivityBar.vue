<script setup lang="ts">
import { RsIcon } from '@niuma/ui'
import { visibleActivityBarItems } from '@/extensions/shell/activity-bar-config'
import { useModuleStore } from '@/stores/module'
import { useShellStore } from '@/stores/shell'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const moduleStore = useModuleStore()
const shellStore = useShellStore()
const { t } = useI18n()

const activities = computed(() => visibleActivityBarItems(moduleStore.items))

/** 点击领域图标：切换分类并展开/收起侧栏（ActivityBar 只做分类，不直接开模块） */
function onCategoryClick(category: (typeof activities.value)[number]['category']) {
  shellStore.selectCategory(category)
}
</script>

<template>
  <nav class="nm-activitybar" :aria-label="t('shell.activityBar')">
    <div class="nm-activitybar__top">
      <button
        v-for="item in activities"
        :key="item.category"
        type="button"
        class="nm-activitybar__item"
        :class="{
          'nm-activitybar__item--active': shellStore.activeCategory === item.category,
        }"
        :title="t(item.labelKey)"
        :aria-label="t(item.labelKey)"
        :aria-pressed="shellStore.activeCategory === item.category"
        @click="onCategoryClick(item.category)"
      >
        <span class="nm-activitybar__hit">
          <RsIcon :name="item.icon" :size="20" />
        </span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.nm-activitybar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: var(--nm-activitybar-w);
  flex-shrink: 0;
  min-height: 0;
  background: var(--nm-activitybar-bg);
  border-right: 1px solid var(--rs-border-subtle);
}

.nm-activitybar__top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--rs-space-xs) 0;
}

.nm-activitybar__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--nm-activitybar-w);
  height: var(--nm-activitybar-w);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: color var(--rs-transition-fast);
}

/*
 * 图标高亮盒：在 3rem 单元内居中的圆角方块（macOS 工具栏式）。
 * hover / 选中态的背景落在此盒上，四周留白，避免整格铺满显得笨重。
 */
.nm-activitybar__hit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--rs-radius);
  transition: background var(--rs-transition-fast);
}

.nm-activitybar__item:hover {
  color: var(--rs-text);
}

.nm-activitybar__item:hover:not(.nm-activitybar__item--active) .nm-activitybar__hit {
  background: color-mix(in srgb, var(--rs-text) 9%, transparent);
}

.nm-activitybar__item--active {
  color: var(--rs-primary);
}

.nm-activitybar__item--active .nm-activitybar__hit {
  background: color-mix(in srgb, var(--rs-primary) 16%, transparent);
}

.nm-activitybar__item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--rs-primary);
}
</style>
