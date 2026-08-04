/** Oracle Instant Client 组件包 ID（与 components/oracle-native/manifest.yaml 对齐）。 */
export const ORACLE_NATIVE_BUNDLE_ID = 'com.niuma.components.oracle-native'

/** Instant Client 工具项：用户浏览指定 oci.dll / libclntsh。 */
export const ORACLE_INSTANT_CLIENT_TOOL_ID = 'instant-client'

/** 是否为 Instant Client 缺失类错误（DPI-1047 / 引导文案）。 */
export function isOracleClientMissingError(message: string | undefined | null): boolean {
  if (!message) return false
  const text = message.toLowerCase()
  return (
    text.includes('dpi-1047') ||
    text.includes('cannot locate a 64-bit oracle client') ||
    text.includes('oracle_home') ||
    text.includes('instant client')
  )
}
