import type { ToolComponentBundle } from '@/api/types/components'
import { createDefaultHandler } from './default'
import { mongodbToolsHandler } from './mongodb-tools'
import { postgresqlClientHandler } from './postgresql-client'
import { vastbaseToolsHandler } from './vastbase-tools'
import type { ComponentBundleHandler } from './types'

/** 按 `components/<slug>/` 注册的包处理器；新增包时在此追加 */
const HANDLERS: ComponentBundleHandler[] = [
  mongodbToolsHandler,
  vastbaseToolsHandler,
  postgresqlClientHandler,
]

const HANDLER_BY_ID = new Map(HANDLERS.map((handler) => [handler.bundleId, handler]))

export function resolveBundleHandler(bundle: ToolComponentBundle): ComponentBundleHandler {
  return HANDLER_BY_ID.get(bundle.bundleId) ?? createDefaultHandler(bundle)
}

export type { ComponentBundleHandler } from './types'
