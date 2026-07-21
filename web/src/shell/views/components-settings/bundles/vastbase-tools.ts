import type { ComponentBundleHandler } from './types'

/** `components/vastbase-tools/` — Vastbase 官方 vb_dump / vb_restore / vsql */
export const vastbaseToolsHandler: ComponentBundleHandler = {
  slug: 'vastbase-tools',
  bundleId: 'com.niuma.components.vastbase-tools',
  icon: 'vastbase',
  localeKey: 'com_niuma_components_vastbase_tools',
  browseAccept: ['.exe', '.cmd', '.bat', ''],
}
