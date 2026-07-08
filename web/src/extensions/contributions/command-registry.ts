import type { CommandContribution } from '@/extensions/types/contribution'

/** 已注册命令的运行时条目 */
export interface RegisteredCommand {
  /** 全局命令 id，如 hello.run */
  id: string
  title: string
  icon?: string
  keybinding?: string
  /** 贡献该命令的扩展 id */
  extensionId: string
}

type CommandHandler = () => void | Promise<void>

const contributions = new Map<string, RegisteredCommand>()
const handlers = new Map<string, CommandHandler>()

/**
 * 从 manifest contributions 注册命令元数据（不含 handler）。
 *
 * @param extensionId - manifest.id
 * @param commands - manifest.contributions.commands
 */
export function registerCommandContributions(
  extensionId: string,
  commands: CommandContribution[] | undefined,
): void {
  if (!commands?.length) {
    return
  }

  for (const cmd of commands) {
    contributions.set(cmd.id, {
      id: cmd.id,
      title: cmd.title,
      icon: cmd.icon,
      keybinding: cmd.keybinding,
      extensionId,
    })
  }
}

/**
 * 扩展 activate 时注册命令执行器。
 *
 * @param commandId - 全局命令 id
 * @param handler - 执行回调
 */
export function registerCommandHandler(commandId: string, handler: CommandHandler): void {
  handlers.set(commandId, handler)
}

/**
 * 返回全部已注册命令，按 title 排序。
 */
export function getRegisteredCommands(): RegisteredCommand[] {
  return [...contributions.values()].sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * 按关键字过滤命令（title / id）。
 *
 * @param query - 搜索词
 */
export function filterCommands(query: string): RegisteredCommand[] {
  const q = query.trim().toLowerCase()
  const all = getRegisteredCommands()
  if (!q) {
    return all
  }
  return all.filter(
    (cmd) => cmd.title.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q),
  )
}

/**
 * 执行命令；无 handler 时返回 false。
 *
 * @param commandId - 全局命令 id
 * @returns 是否找到并执行
 */
export async function executeCommand(commandId: string): Promise<boolean> {
  const handler = handlers.get(commandId)
  if (!handler) {
    return false
  }
  await handler()
  return true
}

/**
 * 清空注册表（测试或热重载用）。
 */
export function clearCommandRegistry(): void {
  contributions.clear()
  handlers.clear()
}
