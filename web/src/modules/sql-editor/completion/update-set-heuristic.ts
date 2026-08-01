/**
 * UPDATE … SET 列补全启发式。
 *
 * monaco-sql-languages / dt-sql-parser 在半成品 `UPDATE t SET ` 时常：
 * - syntax 误报 table（非 column）
 * - entities 收不到目标表
 * 本模块在编排层兜底，不依赖完整 AST。
 */

const IDENT = String.raw`(?:\`[^\`]+\`|"[^"]+"|\[[^\]]+\]|[A-Za-z_][\w$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

/** 去掉 SQL 标识符引号（` " []）。 */
export function stripSqlIdentQuotes(text: string): string {
  const t = text.trim()
  if (t.length >= 2) {
    if ((t.startsWith('`') && t.endsWith('`')) || (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1).replaceAll('``', '`').replaceAll('""', '"')
    }
    if (t.startsWith('[') && t.endsWith(']')) {
      return t.slice(1, -1)
    }
  }
  return t
}

/**
 * 光标是否落在 UPDATE … SET 的「列名」槽位（而非 `=` 右侧值）。
 * 例：`UPDATE t SET |` / `SET a|` / `SET a=1, |` → true；`SET a = |` → false。
 */
export function isUpdateSetColumnSlot(sqlBeforeCaret: string): boolean {
  const afterSet = textAfterLastUpdateSet(sqlBeforeCaret)
  if (afterSet === null) return false
  const segment = afterSet.split(',').at(-1) ?? ''
  // 已出现赋值等号 → 值位置
  if (/=/.test(segment)) return false
  // SET 后只允许空白 / 限定符点号 / 标识符片段
  return /^[\s.`"'\[\]]*[\w$]*$/.test(segment)
}

/**
 * 从 UPDATE 子句抽取目标表（可含 schema.table）。
 * 兼容 MySQL `LOW_PRIORITY|IGNORE` 与 PG `ONLY`。
 * 返回未剥引号的原文关系串，供 parseRelation 使用。
 */
export function extractUpdateTargetRelation(sqlBeforeCaret: string): string | null {
  const m = sqlBeforeCaret.match(
    new RegExp(
      String.raw`\bUPDATE\b(?:\s+ONLY)?(?:\s+(?:LOW_PRIORITY|IGNORE))*\s+(${QUALIFIED})`,
      'i',
    ),
  )
  return m?.[1]?.replace(/\s+/g, '') || null
}

function textAfterLastUpdateSet(sqlBeforeCaret: string): string | null {
  // 找最后一个完整 UPDATE … SET；忽略字符串里的假 SET（足够覆盖常见编辑态）
  const re = /\bUPDATE\b[\s\S]*?\bSET\b/gi
  let lastEnd = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(sqlBeforeCaret)) !== null) {
    lastEnd = m.index + m[0].length
  }
  if (lastEnd < 0) return null
  // SET 之后若已进入 WHERE/ORDER/LIMIT 等，不再视为 SET 列槽
  const rest = sqlBeforeCaret.slice(lastEnd)
  if (/\b(?:WHERE|ORDER\s+BY|LIMIT|RETURNING)\b/i.test(rest)) return null
  return rest
}
