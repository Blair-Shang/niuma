import type { ConnectionNavStrategy } from '@/modules/ops/connection-nav/types'
import { kindIcon } from '@/modules/ops/types'

/**
 * FTP：每次连接树操作新建 Tab；每 Tab 独立 FTP 控制连接（session-policy per_tab）。
 */
export const ftpConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'ftp',
  dedupFocus: false,

  buildTabSpec(item) {
    return {
      moduleId: 'ftp',
      title: item.profileName,
      icon: kindIcon('ftp'),
      props: { profileId: item.profileId },
    }
  },
}
