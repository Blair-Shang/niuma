/** 与仓库 `components/<slug>/` 目录对应的 Web 侧包处理器声明 */
export interface ComponentBundleHandler {
  /** 目录名，如 `mongodb-tools` */
  slug: string
  /** manifest.id，如 `com.niuma.components.mongodb-tools` */
  bundleId: string
  icon: string
  /** i18n 键 `settings.componentBundles.<localeKey>` */
  localeKey: string
  browseAccept: string[]
}
