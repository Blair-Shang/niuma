/**
 * API 页签标题与悬浮提示。标题只用请求名；提示补协议与客户端/服务端。
 */
import { i18n } from '@/locale'
import type { ApiRequest } from '../types'
import { splitSocketUrl } from './request-kind'
import { isSocketMethod } from './target'

/** 页签短标题：与集合树、新建弹窗同一名称。 */
export function tabTitle(req: ApiRequest): string {
  return req.name
}

/**
 * 页签悬浮提示。同名请求靠第二行区分 TCP/UDP 客户端与服务端。
 *
 * @param req - 集合中的请求
 * @returns 换行文本，TabBar 按行渲染
 */
export function tabTooltip(req: ApiRequest): string {
  const name = req.name.trim() || '—'
  const url = req.url.trim() || '—'
  if (isSocketMethod(req.method)) {
    const role = splitSocketUrl(req.url).listen
      ? i18n.global.t('modules.api.socketServer')
      : i18n.global.t('modules.api.socketClient')
    return [name, `${req.method} · ${role}`, url].join('\n')
  }
  return [name, req.method, url].join('\n')
}
