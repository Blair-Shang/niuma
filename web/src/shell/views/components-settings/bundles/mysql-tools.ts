import type { ComponentBundleHandler } from './types'

/** `components/mysql-tools/` — mysqldump / mysql CLI（不编进 platform） */
export const mysqlToolsHandler: ComponentBundleHandler = {
  slug: 'mysql-tools',
  bundleId: 'com.niuma.components.mysql-tools',
  icon: 'mysql',
  localeKey: 'com_niuma_components_mysql_tools',
  browseAccept: ['.exe', '.cmd', '.bat', ''],
}
