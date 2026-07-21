import type { ComponentBundleHandler } from './types'

/** `components/postgresql-client/` — Vastbase / PostgreSQL 客户端工具 */
export const postgresqlClientHandler: ComponentBundleHandler = {
  slug: 'postgresql-client',
  bundleId: 'com.niuma.components.postgresql-client',
  icon: 'vastbase',
  localeKey: 'com_niuma_components_postgresql_client',
  browseAccept: ['.exe', '.cmd', '.bat', ''],
}
