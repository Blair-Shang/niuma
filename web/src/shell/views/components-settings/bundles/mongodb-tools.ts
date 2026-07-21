import type { ComponentBundleHandler } from './types'

/** `components/mongodb-tools/` */
export const mongodbToolsHandler: ComponentBundleHandler = {
  slug: 'mongodb-tools',
  bundleId: 'com.niuma.components.mongodb-tools',
  icon: 'database',
  localeKey: 'com_niuma_components_mongodb_tools',
  browseAccept: ['.exe', '.cmd', '.bat', ''],
}
