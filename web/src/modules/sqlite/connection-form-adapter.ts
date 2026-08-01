import { sqliteApi } from '@/api/sqlite'
import type {
  SqliteAttachEntry,
  SqliteConnectionOptions,
  SqliteSessionTestParams,
} from '@/api/types/sqlite'
import { DEFAULT_SQLITE_OPTIONS } from '@/api/types/sqlite'
import {
  formStr,
  type ConnectionFormAdapter,
  type ConnectionTestParams,
} from '@/modules/ops/connection-form/types'

/** 将 ATTACH 列表序列化为多行文本：alias|filepath 或 alias|filepath|ro */
export function serializeAttachEntries(entries: SqliteAttachEntry[] | undefined): string {
  if (!entries?.length) return ''
  return entries
    .map((e) => {
      const alias = e.alias.trim()
      const filePath = e.filePath.trim()
      if (!alias || !filePath) return ''
      return e.readOnly ? `${alias}|${filePath}|ro` : `${alias}|${filePath}`
    })
    .filter(Boolean)
    .join('\n')
}

/** 解析 ATTACH 多行文本（空行与 # 注释忽略）。 */
export function parseAttachText(text: string): SqliteAttachEntry[] {
  const out: SqliteAttachEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length < 2) continue
    const alias = parts[0] ?? ''
    const filePath = parts[1] ?? ''
    if (!alias || !filePath) continue
    const flag = (parts[2] ?? '').toLowerCase()
    out.push({
      alias,
      filePath,
      readOnly: flag === 'ro' || flag === 'readonly' || flag === 'true',
    })
  }
  return out
}

export const sqliteConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    sqliteFilePath: DEFAULT_SQLITE_OPTIONS.filePath,
    sqliteReadOnly: String(DEFAULT_SQLITE_OPTIONS.readOnly ?? false),
    sqliteCreateIfMissing: String(DEFAULT_SQLITE_OPTIONS.createIfMissing ?? false),
    sqliteJournalMode: DEFAULT_SQLITE_OPTIONS.journalMode ?? '',
    sqliteForeignKeys: String(DEFAULT_SQLITE_OPTIONS.foreignKeys ?? true),
    sqliteExcludeSystem: String(DEFAULT_SQLITE_OPTIONS.exclude_system_schemas ?? true),
    sqliteBusyTimeoutMs: String(DEFAULT_SQLITE_OPTIONS.busyTimeoutMs ?? 5000),
    sqliteAttachText: '',
  }),

  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as SqliteConnectionOptions | undefined
    const filePath = opts?.filePath ?? ''
    form.sqliteFilePath = filePath
    // 同步到 hostAddress，确保通用校验不报「主机地址」必填
    if (filePath) form.hostAddress = filePath
    form.sqliteReadOnly = String(opts?.readOnly ?? DEFAULT_SQLITE_OPTIONS.readOnly)
    form.sqliteCreateIfMissing = String(
      opts?.createIfMissing ?? DEFAULT_SQLITE_OPTIONS.createIfMissing,
    )
    form.sqliteJournalMode = opts?.journalMode ?? DEFAULT_SQLITE_OPTIONS.journalMode ?? ''
    form.sqliteForeignKeys = String(opts?.foreignKeys ?? DEFAULT_SQLITE_OPTIONS.foreignKeys)
    form.sqliteExcludeSystem = String(
      opts?.exclude_system_schemas ?? DEFAULT_SQLITE_OPTIONS.exclude_system_schemas,
    )
    form.sqliteBusyTimeoutMs = String(
      opts?.busyTimeoutMs ?? DEFAULT_SQLITE_OPTIONS.busyTimeoutMs ?? 5000,
    )
    form.sqliteAttachText = serializeAttachEntries(opts?.attach)
  },

  buildOptions({ form, accent }) {
    const filePath = formStr(form, 'sqliteFilePath').trim()
    const attach = parseAttachText(formStr(form, 'sqliteAttachText'))
    return {
      ...DEFAULT_SQLITE_OPTIONS,
      ...accent,
      filePath,
      readOnly: formStr(form, 'sqliteReadOnly') === 'true',
      createIfMissing: formStr(form, 'sqliteCreateIfMissing') === 'true',
      journalMode: formStr(form, 'sqliteJournalMode').trim(),
      foreignKeys: formStr(form, 'sqliteForeignKeys') !== 'false',
      exclude_system_schemas: formStr(form, 'sqliteExcludeSystem') !== 'false',
      busyTimeoutMs: Number(formStr(form, 'sqliteBusyTimeoutMs')) || 5000,
      ...(attach.length > 0 ? { attach } : {}),
    }
  },

  buildTestParams({ input }) {
    const opts = input.connectionOptions as unknown as SqliteConnectionOptions
    // platform resolveInlineConnectParams 要求 hostAddress；文件型协议用路径充当主机
    const filePath = (opts?.filePath?.trim() || input.hostAddress.trim())
    return {
      hostAddress: filePath,
      filePath,
      options: opts,
    } as SqliteSessionTestParams
  },

  callSessionTest(params: ConnectionTestParams) {
    return sqliteApi.sessionTest(params as SqliteSessionTestParams)
  },

  // SQLCipher 等加密库口令：透传为 platform secret
  secret: ({ form }) => form.password.trim(),
  secretRequired: () => false,
  applyLoadedSecret(form, secret) {
    form.password = secret
  },

  validate({ form, t }) {
    const filePath = formStr(form, 'sqliteFilePath').trim()
    if (!filePath) return t('modules.sqlite.form.filePathRequired')
    // 同步路径到 hostAddress，满足通用主机必填校验
    form.hostAddress = filePath
    return null
  },
}
