package ddl

import (
	"fmt"
	"strings"
)

func objectIDLiteral(schema, table string) string {
	return quoteNString(strings.TrimSpace(schema) + "." + strings.TrimSpace(table))
}

func tableCommentSQL(schema, table, comment string) string {
	obj := objectIDLiteral(schema, table)
	return strings.TrimSpace(fmt.Sprintf(`
IF EXISTS (
  SELECT 1 FROM sys.extended_properties ep
  WHERE ep.major_id = OBJECT_ID(%s) AND ep.minor_id = 0 AND ep.class = 1 AND ep.name = N'MS_Description'
)
  EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = %s,
    @level0type = N'SCHEMA', @level0name = %s,
    @level1type = N'TABLE',  @level1name = %s;
ELSE
  EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = %s,
    @level0type = N'SCHEMA', @level0name = %s,
    @level1type = N'TABLE',  @level1name = %s;
`, obj, quoteStringLiteral(comment), quoteNString(schema), quoteNString(table),
		quoteStringLiteral(comment), quoteNString(schema), quoteNString(table)))
}

func columnCommentSQL(schema, table, column, comment string) string {
	obj := objectIDLiteral(schema, table)
	return strings.TrimSpace(fmt.Sprintf(`
IF EXISTS (
  SELECT 1 FROM sys.extended_properties ep
  JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
  WHERE ep.major_id = OBJECT_ID(%s) AND ep.class = 1 AND ep.name = N'MS_Description' AND c.name = %s
)
  EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = %s,
    @level0type = N'SCHEMA', @level0name = %s,
    @level1type = N'TABLE',  @level1name = %s,
    @level2type = N'COLUMN', @level2name = %s;
ELSE
  EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = %s,
    @level0type = N'SCHEMA', @level0name = %s,
    @level1type = N'TABLE',  @level1name = %s,
    @level2type = N'COLUMN', @level2name = %s;
`, obj, quoteNString(column), quoteStringLiteral(comment), quoteNString(schema), quoteNString(table), quoteNString(column),
		quoteStringLiteral(comment), quoteNString(schema), quoteNString(table), quoteNString(column)))
}

func dropDefaultSQL(schema, table, column string) string {
	rel := qualified(schema, table)
	return strings.TrimSpace(fmt.Sprintf(`
DECLARE @df sysname;
SELECT @df = dc.name
FROM sys.default_constraints dc
INNER JOIN sys.columns c ON c.default_object_id = dc.object_id
INNER JOIN sys.tables t ON t.object_id = dc.parent_object_id
INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = %s AND t.name = %s AND c.name = %s;
IF @df IS NOT NULL
  EXEC(N'ALTER TABLE %s DROP CONSTRAINT ' + QUOTENAME(@df));
`, quoteNString(schema), quoteNString(table), quoteNString(column), rel))
}
