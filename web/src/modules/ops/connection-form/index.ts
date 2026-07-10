/**
 * 运维连接表单扩展机制出口。
 *
 * 本目录只负责“表单数据逻辑”：默认值、编辑回填、保存 options、测试参数、
 * 凭据读取/写入规则。表单 UI 片段仍放在 modules/connection/registry.ts。
 */
export type {
  ConnectionDlgMode,
  ConnectionFormAdapter,
  ConnectionFormAdapterBuildContext,
  ConnectionFormAdapterSecretContext,
  ConnectionFormAdapterTestContext,
  ConnectionFormAdapterValidateContext,
  ConnectionFormState,
  ConnectionTestParams,
} from './types'
export { getConnectionFormAdapter, registerConnectionFormAdapter } from './registry'
export {
  ftpConnectionFormAdapter,
  mongodbConnectionFormAdapter,
  redisConnectionFormAdapter,
  sshConnectionFormAdapter,
} from './builtin-adapters'
