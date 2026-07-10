/**
 * 内置连接协议 UI 注册
 * ──────────────────────────────────────────────────────────────────────────
 * 此文件是添加新协议的唯一改动点（在已有模块结构下）。
 *
 * 每个协议在这里注册三部分：
 *   - registerConnectionFormAdapter()：表单数据适配器（默认值、回填、保存 options、测试、凭据）
 *   - registerConnectionKind()      ：该协议向通用连接表单贡献的 UI 片段
 *   - registerConnectionNavStrategy()：连接树 → Tab 导航（在 conn-nav-providers.ts 注册）
 *
 * UI 片段字段：
 *   - credentialSection：替换凭据区（SSH 多认证方式）
 *   - credentialHint   ：凭据行下方提示 i18n key（Redis 密码可选提示）
 *   - options          ：协议专属选项区（FTP 编码/协议，Redis 拓扑/数据库/节点）
 *   - supportsTunnel   ：是否展示隧道 Tab（FTP / SSH / Redis 均已支持跳板机隧道）
 *   - passwordOptional ：密码非必填（Redis、匿名 FTP 等）
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 新增协议步骤（以 MySQL 为例）：
 *
 *   1. 在 modules/mysql/components/ 创建 MysqlConnectionFields.vue
 *      （参考 FtpConnectionFields.vue，接受 :form prop，渲染数据库名/字符集等字段）
 *
 *   2. 在 connection-form/builtin-adapters.ts 或协议模块中添加 mysqlConnectionFormAdapter
 *
 *   3. 在本文件添加表单注册；在 conn-nav-providers.ts 添加导航策略：
 *        registerConnectionFormAdapter('mysql', mysqlConnectionFormAdapter)
 *        registerConnectionKind('mysql', { options: MysqlConnectionFields })
 *        registerConnectionNavStrategy('mysql', mysqlConnectionNavStrategy)
 *
 *   4. 在 modules/mysql/conn-nav-strategy.ts 实现 L3 策略（参考 mongodb）
 *   5. 在 ops/types.ts 的 CONN_KIND_DEFS 追加 mysql 的 kind 定义
 *
 *   本文件之外（OpsConnectionPanel.vue、ConnectionFormDialog.vue 等）无需修改。
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 调用时机：
 *   本函数由 main.ts 在 Vue app.mount() 之前调用，确保所有使用此注册表的
 *   组件（OpsConnectionPanel 等）挂载时已能查到完整的注册信息。
 */

import { registerConnectionKind } from '@/modules/connection/registry'
import {
  ftpConnectionFormAdapter,
  mongodbConnectionFormAdapter,
  redisConnectionFormAdapter,
  registerConnectionFormAdapter,
  sshConnectionFormAdapter,
} from '@/modules/ops/connection-form/index'
import FtpConnectionFields from '@/modules/ftp/components/FtpConnectionFields.vue'
import MongoConnectionFields from '@/modules/mongodb/components/MongoConnectionFields.vue'
import RedisConnectionFields from '@/modules/redis/components/RedisConnectionFields.vue'
import SshConnectionFields from '@/modules/ssh/components/SshConnectionFields.vue'
import SshConnectionOptionsFields from '@/modules/ssh/components/SshConnectionOptionsFields.vue'

export function registerBuiltinConnectionKinds(): void {
  registerConnectionFormAdapter('ftp', ftpConnectionFormAdapter)
  registerConnectionKind('ftp', {
    options: FtpConnectionFields,
    supportsTunnel: true,
  })

  registerConnectionFormAdapter('redis', redisConnectionFormAdapter)
  registerConnectionKind('redis', {
    options: RedisConnectionFields,
    credentialHint: 'modules.redis.form.passwordHint',
    passwordOptional: true,
    supportsTunnel: true,
  })

  registerConnectionFormAdapter('mongodb', mongodbConnectionFormAdapter)
  registerConnectionKind('mongodb', {
    options: MongoConnectionFields,
    passwordOptional: true,
    supportsTunnel: true,
  })

  registerConnectionFormAdapter('ssh', sshConnectionFormAdapter)
  registerConnectionKind('ssh', {
    // SSH 凭据结构（用户名 + 认证方式 + 密码/私钥/路径/passphrase）与其他协议不同，
    // 整体替换默认「用户名 + 密码」区而非追加选项区。
    credentialSection: SshConnectionFields,
    options: SshConnectionOptionsFields,
    supportsTunnel: true,
  })
}
