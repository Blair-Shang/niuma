import { describe, expect, it } from 'vitest'
import {
  isProtectedDatabase,
  isSystemCollection,
  isValidMongoCollectionName,
  isValidMongoDatabaseName,
} from '@/modules/mongodb/utils/catalog-names'

describe('mongodb catalog-names', () => {
  it('rejects reserved and invalid database names', () => {
    expect(isValidMongoDatabaseName('mydb')).toBe(true)
    expect(isValidMongoDatabaseName('  shop  ')).toBe(true)
    expect(isValidMongoDatabaseName('')).toBe(false)
    expect(isValidMongoDatabaseName('my.db')).toBe(false)
    expect(isValidMongoDatabaseName('admin')).toBe(false)
    expect(isProtectedDatabase(' local ')).toBe(true)
  })

  it('rejects system and invalid collection names', () => {
    expect(isValidMongoCollectionName('users')).toBe(true)
    expect(isValidMongoCollectionName('user.profile')).toBe(true)
    expect(isValidMongoCollectionName('')).toBe(false)
    expect(isValidMongoCollectionName('system.profile')).toBe(false)
    expect(isValidMongoCollectionName('foo$bar')).toBe(false)
    expect(isSystemCollection('system.views')).toBe(true)
  })
})
