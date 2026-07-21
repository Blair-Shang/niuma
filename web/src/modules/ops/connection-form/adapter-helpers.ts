import type { CredentialInput } from '@/api/types/connection'
import {
  formatTimeoutFormValue,
  parseTimeoutFormValue,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'
import type { ConnectionFormState } from './types'

/** 将 Redis 节点输入框中的换行/逗号分隔文本解析为 host:port 数组。 */
export function parseRedisNodesText(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function applyStoredTimeout(
  form: ConnectionFormState,
  options: Record<string, unknown> | undefined,
  defaultSeconds: number,
): void {
  const stored = readStoredTimeoutSeconds(options, defaultSeconds)
  form.connectTimeoutSeconds = formatTimeoutFormValue(stored, defaultSeconds)
}

export function buildTimeoutSeconds(form: ConnectionFormState, defaultSeconds: number): number {
  return parseTimeoutFormValue(form.connectTimeoutSeconds, defaultSeconds)
}

/** 默认密码型协议直接使用通用 password 字段作为 Keychain secret。 */
export function basePasswordSecret({ form }: { form: ConnectionFormState }): string {
  return form.password.trim()
}

/** 默认凭据类型为 password；SSH 私钥 adapter 会覆盖该行为。 */
export function passwordCredentialKind(): CredentialInput['kind'] {
  return 'password'
}

/** 默认凭据缺失提示。 */
export function passwordRequiredMessage(_form: ConnectionFormState, t: (key: string) => string): string {
  return t('opsNav.passwordRequired')
}
