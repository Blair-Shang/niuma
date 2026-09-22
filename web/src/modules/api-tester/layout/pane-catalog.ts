/**
 * 协议静态表。对齐运维 CONN_KIND_DEFS：启动可读 methods / creates，不 import 工作台 Vue。
 */
import { applyHttpDefaults } from '../http/defaults'
import { applyTcpDefaults, tcpCreates } from '../tcp/defaults'
import { applyUdpDefaults, udpCreates } from '../udp/defaults'
import { applyWebsocketDefaults } from '../websocket/defaults'
import type { ApiPaneKind, ApiPaneKindDef } from './pane-types'

export const API_PANE_KIND_DEFS: readonly ApiPaneKindDef[] = [
  {
    kind: 'http',
    icon: 'globe',
    labelKey: 'modules.api.paneHttp',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    applyDefaults: applyHttpDefaults,
    creates: [{ method: 'GET', labelKey: 'modules.api.newRequest', icon: 'plus' }],
  },
  {
    kind: 'tcp',
    icon: 'unplug',
    labelKey: 'modules.api.paneTcp',
    methods: ['TCP'],
    applyDefaults: applyTcpDefaults,
    creates: [tcpCreates],
  },
  {
    kind: 'udp',
    icon: 'radio',
    labelKey: 'modules.api.paneUdp',
    methods: ['UDP'],
    applyDefaults: applyUdpDefaults,
    creates: [udpCreates],
  },
  {
    kind: 'websocket',
    icon: 'unplug',
    labelKey: 'modules.api.paneWebsocket',
    methods: ['WS'],
    applyDefaults: applyWebsocketDefaults,
  },
]

const defByKind = new Map(API_PANE_KIND_DEFS.map((def) => [def.kind, def]))

export function apiPaneKindDef(kind: ApiPaneKind): ApiPaneKindDef {
  const def = defByKind.get(kind)
  if (!def) throw new Error(`api pane kind unknown: ${kind}`)
  return def
}
