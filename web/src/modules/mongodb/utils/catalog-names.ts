/** MongoDB 系统库，禁止用户新建或重命名。 */
export const MONGO_PROTECTED_DATABASES = new Set(['admin', 'local', 'config'])

const maxDatabaseNameRunes = 64
const maxCollectionNameRunes = 255
const invalidDatabaseChars = /[/\\. "$\u0000]/
const invalidCollectionChars = /[$\u0000]/

function runeCount(value: string): number {
  return [...value].length
}

/** 判断是否为系统库。 */
export function isProtectedDatabase(name: string | undefined): boolean {
  return Boolean(name && MONGO_PROTECTED_DATABASES.has(name.trim()))
}

/** 判断是否为系统集合（如 system.profile）。 */
export function isSystemCollection(name: string | undefined): boolean {
  return Boolean(name?.startsWith('system.'))
}

/** 校验用户库名（新建 / 重命名目标）。 */
export function isValidMongoDatabaseName(name: string): boolean {
  const n = name.trim()
  if (!n || runeCount(n) > maxDatabaseNameRunes) return false
  if (isProtectedDatabase(n)) return false
  return !invalidDatabaseChars.test(n)
}

/** 校验用户集合名。 */
export function isValidMongoCollectionName(name: string): boolean {
  const n = name.trim()
  if (!n || runeCount(n) > maxCollectionNameRunes) return false
  if (isSystemCollection(n)) return false
  return !invalidCollectionChars.test(n)
}
