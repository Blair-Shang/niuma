/**
 * workspace JSON 落盘（nm_app_setting.api.workspace）。
 * 结构变更 flushNow；字段编辑 markDirty 防抖。
 * 不在这里 watch folders：整库 deep watch 会在每次按键 traverse 全部 body。
 */
export const WORKSPACE_PERSIST_DEBOUNCE_MS = 700

export interface WorkspacePersister {
  /** 字段编辑：合并多次按键，到期再写。 */
  markDirty: (delayMs?: number) => void
  /** 增删移文件夹 / 请求：立刻落盘。 */
  flushNow: () => void
  /** 取消未触发的定时器（beforeunload 前先 flush）。 */
  cancelTimer: () => void
  /** hydrate 完成前记下的脏标记，ready 后补写。 */
  replayPending: () => void
}

export function createWorkspacePersister(opts: {
  canWrite: () => boolean
  serialize: () => string
  write: (payload: string) => void
  debounceMs?: number
}): WorkspacePersister {
  const debounceMs = opts.debounceMs ?? WORKSPACE_PERSIST_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let pendingDelay = debounceMs

  function flushNow(): void {
    if (!opts.canWrite()) {
      pending = true
      pendingDelay = 0
      return
    }
    cancelTimer()
    let payload = ''
    try {
      payload = opts.serialize()
    } catch (error) {
      console.warn('[api-tester] workspace serialize failed', error)
      return
    }
    opts.write(payload)
  }

  function markDirty(delayMs = debounceMs): void {
    if (!opts.canWrite()) {
      pending = true
      pendingDelay = Math.min(pendingDelay, delayMs)
      return
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flushNow()
    }, delayMs)
  }

  function cancelTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function replayPending(): void {
    if (!pending) return
    const delay = pendingDelay
    pending = false
    pendingDelay = debounceMs
    if (delay <= 0) flushNow()
    else markDirty(delay)
  }

  return { markDirty, flushNow, cancelTimer, replayPending }
}
