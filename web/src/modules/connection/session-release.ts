import type { InjectionKey } from 'vue'

export type SessionReleaseCleanup = () => void | Promise<void>

/** Tab 释放时由子 Pane 注册的清理回调（停流、注销传输等） */
export const SESSION_RELEASE_CLEANUP_KEY: InjectionKey<(fn: SessionReleaseCleanup) => void> =
  Symbol('session-release-cleanup')
