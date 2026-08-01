import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { clickhouseConnectionFormAdapter } from '@/modules/clickhouse/connection-form-adapter'
import ClickHouseConnectionFields from '@/modules/clickhouse/components/ClickHouseConnectionFields.vue'
import ClickHouseSslFields from '@/modules/clickhouse/components/ClickHouseSslFields.vue'
import ClickHouseAdvancedFields from '@/modules/clickhouse/components/ClickHouseAdvancedFields.vue'

let registered = false

export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('clickhouse', clickhouseConnectionFormAdapter)
  registerConnectionKind('clickhouse', {
    options: ClickHouseConnectionFields,
    ssl: ClickHouseSslFields,
    advanced: ClickHouseAdvancedFields,
    supportsTunnel: true,
  })
}
