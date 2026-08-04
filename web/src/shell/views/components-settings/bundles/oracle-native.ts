import type { ComponentBundleHandler } from './types'

/** `components/oracle-native/` — Oracle Instant Client（选目录自动匹配 oci.dll） */
export const oracleNativeHandler: ComponentBundleHandler = {
  slug: 'oracle-native',
  bundleId: 'com.niuma.components.oracle-native',
  icon: 'oracle',
  localeKey: 'com_niuma_components_oracle_native',
  browseAccept: ['.dll', '.so', ''],
  browseMode: 'folder',
  libraryNames: ['oci.dll', 'libclntsh.so'],
}
