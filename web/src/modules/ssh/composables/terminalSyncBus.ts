type TerminalSyncEvent = {
  syncGroupId: string
  sourceInstanceId: string
  data: string
}

type Handler = (event: TerminalSyncEvent) => void

const subscribersByGroup = new Map<string, Set<Handler>>()

export function subscribeTerminalSync(syncGroupId: string, handler: Handler): () => void {
  let set = subscribersByGroup.get(syncGroupId)
  if (!set) {
    set = new Set()
    subscribersByGroup.set(syncGroupId, set)
  }
  set.add(handler)
  return () => {
    set.delete(handler)
    if (set.size === 0) {
      subscribersByGroup.delete(syncGroupId)
    }
  }
}

export function publishTerminalSync(event: TerminalSyncEvent): void {
  const set = subscribersByGroup.get(event.syncGroupId)
  if (!set || set.size === 0) {
    return
  }
  for (const fn of set) {
    fn(event)
  }
}

