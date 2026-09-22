/**
 * UDP 新建默认值与右键项。地址规则与工作台解析复用 tcp/（同一套收发壳）。
 */
import { applySocketDefaults, socketCreates } from '../tcp/defaults'

export const applyUdpDefaults = applySocketDefaults
export const udpCreates = socketCreates('UDP', 'modules.api.newUdp', 'radio')
