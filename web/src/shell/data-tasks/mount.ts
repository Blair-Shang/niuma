/** 底部 Dock 内数据任务内容挂载点（供 Teleport） */
export const DATA_TASK_DOCK_MOUNT_ID = 'nm-data-task-dock-mount'

export function dataTaskDockMountSelector(): string {
  return `#${DATA_TASK_DOCK_MOUNT_ID}`
}
