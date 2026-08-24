/**
 * 连接树 DDL 弹窗互斥。
 *
 * 各协议 ActionHost 同时挂在 OpsConnectionPanel，pending 分属各自 Pinia。
 * 未关上一张再建另一协议的「新建数据库」时，两张 Reka Dialog 叠层，
 * 双焦点锁 / body pointer-events 会导致所有弹窗都关不掉。
 */

const clears = new Map<string, () => void>()

/** 登记某协议队列的关闭函数（store 初始化时调用一次）。 */
export function registerDdlDialogClear(id: string, clear: () => void): void {
  clears.set(id, clear)
}

/** 打开本协议弹窗前关掉其它协议已打开的 DDL 对话框。 */
export function dismissOtherDdlDialogs(id: string): void {
  for (const [key, clear] of clears) {
    if (key !== id) clear()
  }
}
