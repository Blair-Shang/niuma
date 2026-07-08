/**
 * 跨编辑组 Tab 拖拽的共享状态。
 *
 * 每个编辑组各渲染一个 `TabBar` 实例，`<script setup>` 顶层变量按实例隔离，
 * 无法跨实例共享。此处用模块级 ref 暴露「当前被拖拽的 Tab / 源组」，
 * 让任意目标组的 TabBar 在 drop 时能判定是同组排序还是跨组移动。
 */
import { ref } from 'vue'

/** 正在拖拽的 Tab id（无拖拽时为 null） */
export const draggingTabId = ref<string | null>(null)
/** 被拖拽 Tab 的源组 id */
export const draggingGroupId = ref<string | null>(null)

/** 开始拖拽某 Tab */
export function beginTabDrag(tabId: string, groupId: string): void {
  draggingTabId.value = tabId
  draggingGroupId.value = groupId
}

/** 结束拖拽，清空共享状态 */
export function endTabDrag(): void {
  draggingTabId.value = null
  draggingGroupId.value = null
}
