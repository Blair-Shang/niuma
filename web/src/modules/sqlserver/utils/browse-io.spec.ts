import { describe, expect, it } from 'vitest'
import {
  buildDeleteSqlText,
  buildInsertSqlText,
  buildUpdateSqlText,
} from '@/modules/sqlserver/utils/browse-io'

describe('sqlserver browse-io', () => {
  it('builds INSERT / UPDATE / DELETE', () => {
    expect(
      buildInsertSqlText('dbo', 'T', [{ name: 'Id' }, { name: 'Name' }], [[1, "O'Brien"]]),
    ).toBe("INSERT INTO [dbo].[T] ([Id], [Name]) VALUES (1, N'O''Brien');\n")

    expect(
      buildUpdateSqlText('dbo', 'T', ['Name'], ['Id'], [{ Id: 1, Name: 'a' }]),
    ).toBe("UPDATE [dbo].[T] SET [Name] = N'a' WHERE [Id] = 1;\n")

    expect(buildDeleteSqlText('dbo', 'T', ['Id'], [{ Id: 1 }])).toBe(
      'DELETE FROM [dbo].[T] WHERE [Id] = 1;\n',
    )
  })
})
