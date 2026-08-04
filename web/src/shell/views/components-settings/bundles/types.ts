/** 与仓库 `components/<slug>/` 目录对应的 Web 侧包处理器声明 */
export interface ComponentBundleHandler {
  /** 目录名，如 `mongodb-tools` */
  slug: string
  /** manifest.id，如 `com.niuma.components.mongodb-tools` */
  bundleId: string
  icon: string
  /** i18n 键 `settings.componentBundles.<localeKey>` */
  localeKey: string
  /** `browseMode: 'file'` 时传给 `shell.dialog.openFile` 的扩展名过滤 */
  browseAccept: string[]
  /**
   * 浏览方式：
   * - `file`（默认）：选可执行文件
   * - `folder`：选目录，再按 `libraryNames` 自动匹配库文件并填充路径
   */
  browseMode?: 'file' | 'folder'
  /**
   * `browseMode: 'folder'` 时在目录内优先匹配的文件名（大小写不敏感）。
   * 也匹配 `libclntsh.so*` 这类带版本后缀的共享库。
   */
  libraryNames?: string[]
}
