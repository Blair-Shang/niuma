/** 发送时并入当前激活页签（已有同 id 则不重复）。 */
export function mergeActiveTabAttachment<T extends { id: string }>(
  list: T[],
  active: T | null | undefined,
): T[] {
  if (!active) {
    return list
  }
  if (list.some((a) => a.id === active.id)) {
    return list
  }
  return [active, ...list]
}
