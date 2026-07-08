<script setup lang="ts">
import WindowControls from '@/shell/widgets/WindowControls.vue'
import { useWindowChromeStore } from '@/stores/window-chrome'

defineProps<{
  /** 居中显示的窗口标题（通常为当前文档名或模块名） */
  title: string
}>()

const chrome = useWindowChromeStore()

async function onTitleBarDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.nm-no-drag')) {
    return
  }
  await chrome.toggleMaximize()
}
</script>

<template>
  <header class="nm-aux-titlebar nm-topbar shrink-0" @dblclick="onTitleBarDoubleClick">
    <div class="nm-aux-titlebar__title nm-drag-region" :title="title">
      {{ title }}
    </div>
    <div class="nm-topbar__spacer nm-drag-region" aria-hidden="true" />
    <div class="nm-topbar__actions nm-no-drag">
      <WindowControls variant="trailing" />
    </div>
  </header>
</template>
