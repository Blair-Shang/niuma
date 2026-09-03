import type { ConnectionNavStrategy } from '@/modules/ops/connection-nav/types'
import { kindIcon } from '@/modules/ops/types'

/**
 * SFTP：每次连接树操作新建 Tab；每 Tab 独立物理会话（session-policy per_tab）。
 */
export const sftpConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'sftp',
  dedupFocus: false,

  buildTabSpec(item) {
    return {
      moduleId: 'sftp',
      title: item.profileName,
      icon: kindIcon('sftp'),
      props: { profileId: item.profileId },
    }
  },
}
