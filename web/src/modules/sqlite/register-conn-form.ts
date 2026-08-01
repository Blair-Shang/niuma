import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { sqliteConnectionFormAdapter } from '@/modules/sqlite/connection-form-adapter'
import SqliteConnectionFields from '@/modules/sqlite/components/SqliteConnectionFields.vue'
import SqliteAdvancedFields from '@/modules/sqlite/components/SqliteAdvancedFields.vue'

let registered = false

/**
 * 仅注册 SQLite 连接表单（对话框路径）。
 * SQLite 无 SSL / 隧道，仅展示文件路径 + 高级选项。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('sqlite', sqliteConnectionFormAdapter)
  registerConnectionKind('sqlite', {
    options: SqliteConnectionFields,
    advanced: SqliteAdvancedFields,
    passwordOptional: true,
    supportsTunnel: false,
    hideHostPort: true,
    hideCredentials: true,
  })
}
