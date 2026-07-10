import type { ConnectionNavStrategy } from '@/modules/ops/connection-nav/types'
import { kindIcon } from '@/modules/ops/types'

/**
 * SSH：每次连接树操作新建 Tab；每 Tab 独立物理会话（session-policy per_tab）。
 */
export const sshConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'ssh',
  dedupFocus: false,

  buildTabSpec(item) {
    return {
      moduleId: 'ssh',
      title: item.profileName,
      icon: kindIcon('ssh'),
      props: { profileId: item.profileId },
    }
  },
}
