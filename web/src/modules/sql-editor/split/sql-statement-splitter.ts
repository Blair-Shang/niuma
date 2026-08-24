/**
 * 跨方言 SQL 语句拆分（docs/22 §5.2 批量执行前置）。
 *
 * 词法单次扫描分号，跳过字符串 / 注释 / 方言特有引号体。
 * 对标 Neon / DbGate 一类「编辑器拆句」路线，不做完整 AST。
 *
 * Vastbase / Oracle / Dameng：`plsqlBlocks` 开启时，CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER
 * … 裸 PL/SQL 体、DECLARE/BEGIN 匿名块内的 `;` 不拆句；独立行 `/`（gsql / SQL\*Plus）可作结束符。
 * 声明段内嵌套 `PROCEDURE`/`FUNCTION` 的 `END;` 不结束外层 CREATE（routineDepth）。
 *
 * MySQL：
 * - `delimiterBlocks`：识别行首 `DELIMITER <token>`（CLI 粘贴兼容）；指令行不输出。
 * - `mysqlCompoundBlocks`：`CREATE PROCEDURE|FUNCTION … BEGIN…END;` 体内 `;` 不拆句
 *   （对齐 Navicat：编辑器可直接写过程，无需手写 DELIMITER）。
 *
 * T-SQL：`goBatches` 开启时，独立行 `GO` 为批边界（`GO` 行不输出给服务器）。
 */
import type { SqlDialect } from '../dialect'
import {
  resolveSqlSplitFeatures,
  type SplitSqlOptions,
  type SqlSplitFeatures,
  type SqlStatementSlice,
} from './types'

const CHAR_TAB = 9
const CHAR_LF = 10
const CHAR_CR = 13
const CHAR_SPACE = 32
const CHAR_HASH = 35
const CHAR_AMP = 38
const CHAR_SQUOTE = 39
const CHAR_DQUOTE = 34
const CHAR_DASH = 45
const CHAR_SLASH = 47
const CHAR_SEMI = 59
const CHAR_EQ = 61
const CHAR_AT = 64
const CHAR_BACKSLASH = 92
const CHAR_BACKTICK = 96
const CHAR_DOLLAR = 36
const CHAR_STAR = 42
const CHAR_A = 65
const CHAR_Z = 90
const CHAR_a = 97
const CHAR_z = 122
const CHAR_0 = 48
const CHAR_9 = 57
const CHAR_UNDERSCORE = 95

/** 取码点；越界时返回 0（调用方已做边界检查时可当作 ASCII 码点读取）。 */
function codeAt(s: string, i: number): number {
  return s.codePointAt(i) ?? 0
}

function isWs(c: number): boolean {
  return c === CHAR_SPACE || c === CHAR_TAB || c === CHAR_LF || c === CHAR_CR
}

function isIdentStart(c: number): boolean {
  return (c >= CHAR_A && c <= CHAR_Z) || (c >= CHAR_a && c <= CHAR_z) || c === CHAR_UNDERSCORE
}

function isIdentCont(c: number): boolean {
  return isIdentStart(c) || (c >= CHAR_0 && c <= CHAR_9)
}

function isIdentContChar(ch: string): boolean {
  if (!ch) return false
  return isIdentCont(codeAt(ch, 0))
}

function toLowerAscii(c: number): number {
  return c >= CHAR_A && c <= CHAR_Z ? c + 32 : c
}

/**
 * 匹配标识符边界上的关键字（大小写不敏感）。
 * @returns 关键字结束后的下标；不匹配返回 -1
 */
function matchKeyword(sql: string, i: number, word: string): number {
  const n = sql.length
  const wlen = word.length
  if (i < 0 || i + wlen > n) return -1
  if (i > 0 && isIdentCont(codeAt(sql, i - 1))) return -1
  for (let k = 0; k < wlen; k++) {
    if (toLowerAscii(codeAt(sql, i + k)) !== toLowerAscii(word.charCodeAt(k))) return -1
  }
  if (i + wlen < n && isIdentCont(codeAt(sql, i + wlen))) return -1
  return i + wlen
}

/** 跳过单引号串；`backslash` 时认 `\` 转义。返回串结束后的下标。 */
function skipSingleQuoted(sql: string, openQuote: number, backslash: boolean): number {
  const n = sql.length
  let i = openQuote + 1
  while (i < n) {
    const c = codeAt(sql, i)
    if (backslash && c === CHAR_BACKSLASH && i + 1 < n) {
      i += 2
      continue
    }
    if (c === CHAR_SQUOTE) {
      if (i + 1 < n && codeAt(sql, i + 1) === CHAR_SQUOTE) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return n
}

/** 跳过双引号 / 反引号标识符（支持成对转义）。 */
function skipQuotedIdent(sql: string, open: number, quote: number): number {
  const n = sql.length
  let i = open + 1
  while (i < n) {
    const c = codeAt(sql, i)
    if (c === quote) {
      if (i + 1 < n && codeAt(sql, i + 1) === quote) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return n
}

/**
 * PG dollar-quote：`$` / `$tag$`，tag 为空或 `[A-Za-z_][A-Za-z0-9_]*`。
 * 未闭合时返回 `sql.length`（剩余不再拆分）。
 */
function skipDollarQuote(sql: string, openDollar: number): number {
  const n = sql.length
  let j = openDollar + 1
  if (j < n && isIdentStart(codeAt(sql, j))) {
    j++
    while (j < n && isIdentCont(codeAt(sql, j))) j++
  }
  if (j >= n || codeAt(sql, j) !== CHAR_DOLLAR) {
    return openDollar + 1 // 不是合法 dollar-quote 开头，仅跳过当前 `$`
  }
  const tagEnd = j + 1
  const tagLen = tagEnd - openDollar
  // 从内容区找闭合 tag（避免 String.indexOf 在热路径反复建子串）
  let i = tagEnd
  while (i + tagLen <= n) {
    if (codeAt(sql, i) !== CHAR_DOLLAR) {
      i++
      continue
    }
    let k = 0
    while (k < tagLen && codeAt(sql, i + k) === codeAt(sql, openDollar + k)) k++
    if (k === tagLen) return i + tagLen
    i++
  }
  return n
}

function skipLineComment(sql: string, start: number): number {
  const n = sql.length
  let i = start
  while (i < n && codeAt(sql, i) !== CHAR_LF) i++
  return i
}

function skipBlockComment(sql: string, start: number, nested: boolean): number {
  const n = sql.length
  let i = start + 2
  let depth = 1
  while (i < n && depth > 0) {
    const c = codeAt(sql, i)
    if (nested && c === CHAR_SLASH && i + 1 < n && codeAt(sql, i + 1) === CHAR_STAR) {
      depth++
      i += 2
      continue
    }
    if (c === CHAR_STAR && i + 1 < n && codeAt(sql, i + 1) === CHAR_SLASH) {
      depth--
      i += 2
      continue
    }
    i++
  }
  return i
}

function skipOracleQQuote(sql: string, qIndex: number): number {
  const n = sql.length
  // q'X … X'
  if (qIndex + 2 >= n) return qIndex + 1
  const opener = codeAt(sql, qIndex + 2)
  let closer = opener
  if (opener === 91) closer = 93 // [ ]
  else if (opener === 40) closer = 41 // ( )
  else if (opener === 123) closer = 125 // { }
  else if (opener === 60) closer = 62 // < >
  let i = qIndex + 3
  while (i < n) {
    if (codeAt(sql, i) === closer && i + 1 < n && codeAt(sql, i + 1) === CHAR_SQUOTE) {
      return i + 2
    }
    i++
  }
  return n
}

/** 是否位于 `E'` / `e'` / `U&'` 前缀之后的引号位置。 */
function hasPostgresEscapePrefix(sql: string, quoteIndex: number): boolean {
  if (quoteIndex <= 0) return false
  const prev = codeAt(sql, quoteIndex - 1)
  // E' / e'
  if (prev === 69 || prev === 101) {
    // E / e
    return quoteIndex < 2 || !isIdentCont(codeAt(sql, quoteIndex - 2))
  }
  // U&' / u&'
  if (prev === CHAR_AMP && quoteIndex >= 2) {
    const u = codeAt(sql, quoteIndex - 2)
    if (u === 85 || u === 117) {
      return quoteIndex < 3 || !isIdentCont(codeAt(sql, quoteIndex - 3))
    }
  }
  return false
}

/** 跳过空白与注释（拆句状态机 peek / 句首对齐用）。 */
function skipWsAndComments(sql: string, from: number, features: SqlSplitFeatures): number {
  const n = sql.length
  let i = from
  while (i < n) {
    const c = codeAt(sql, i)
    const c1 = i + 1 < n ? codeAt(sql, i + 1) : 0
    if (isWs(c)) {
      i++
      continue
    }
    if (c === CHAR_DASH && c1 === CHAR_DASH) {
      i = skipLineComment(sql, i + 2)
      continue
    }
    if (features.hashLineComments && c === CHAR_HASH) {
      i = skipLineComment(sql, i + 1)
      continue
    }
    if (c === CHAR_SLASH && c1 === CHAR_STAR) {
      i = skipBlockComment(sql, i, features.nestedBlockComments)
      continue
    }
    break
  }
  return i
}

/**
 * 独立行 `/`（gsql / SQL\*Plus 缓冲结束符）：该行除空白外只有一个 `/`。
 */
function isSlashTerminatorAt(sql: string, slashIndex: number): boolean {
  if (codeAt(sql, slashIndex) !== CHAR_SLASH) return false
  let lineStart = slashIndex
  while (lineStart > 0 && codeAt(sql, lineStart - 1) !== CHAR_LF) lineStart--
  for (let j = lineStart; j < slashIndex; j++) {
    const c = codeAt(sql, j)
    if (c !== CHAR_SPACE && c !== CHAR_TAB && c !== CHAR_CR) return false
  }
  const n = sql.length
  let j = slashIndex + 1
  while (j < n) {
    const c = codeAt(sql, j)
    if (c === CHAR_LF) break
    if (c === CHAR_CR) break
    if (c !== CHAR_SPACE && c !== CHAR_TAB) return false
    j++
  }
  return true
}

function advancePastSlashLine(sql: string, slashIndex: number): number {
  const n = sql.length
  let i = slashIndex + 1
  while (i < n && codeAt(sql, i) !== CHAR_LF) i++
  if (i < n && codeAt(sql, i) === CHAR_LF) i++
  return i
}

type PlsqlMode =
  | { kind: 'off' }
  | { kind: 'await_as_is' }
  /** MySQL：CREATE PROCEDURE/FUNCTION 之后等待 BEGIN */
  | { kind: 'await_begin' }
  | {
      kind: 'body'
      beginDepth: number
      endPending: boolean
      /**
       * 子程序嵌套深度。CREATE/匿名块进入体时为 1；
       * 声明段内再遇 PROCEDURE/FUNCTION 则 +1。
       * 嵌套子程序的 END; 只减此深度，不得结束外层 CREATE。
       */
      routineDepth: number
      /**
       * CASE 表达式 / CASE 语句深度。
       * `CASE … END`（表达式）与 `CASE … END CASE` 的 END 不得误减 beginDepth。
       */
      caseDepth: number
    }

function usesCompoundBody(features: SqlSplitFeatures): boolean {
  return features.plsqlBlocks || features.mysqlCompoundBlocks
}

function bodyMode(
  beginDepth: number,
  endPending: boolean,
  routineDepth: number,
  caseDepth = 0,
): PlsqlMode {
  return { kind: 'body', beginDepth, endPending, routineDepth, caseDepth }
}

/** 语句边界：end 为切片排他下标；delimiterIndex 供 UI；includeDelimiter 仅影响 end。 */
interface StatementBoundary {
  /** 切片结束下标（不含其后内容） */
  end: number
  /** 分隔符（`;` / `/` / 自定义 DELIMITER）下标；无则为 -1 */
  delimiterIndex: number
  /** 分隔符字节长度（默认 1；DELIMITER 指令行可跨整行） */
  delimiterLength: number
}

/**
 * 解析行首 `DELIMITER <token>`（MySQL 客户端指令）。
 * @returns 行结束后的下标与新分隔符；非指令返回 null
 */
function tryParseDelimiterDirective(
  sql: string,
  i: number,
): { next: number; delimiter: string } | null {
  const afterKw = matchKeyword(sql, i, 'delimiter')
  if (afterKw < 0) return null
  const n = sql.length
  let p = afterKw
  let sawSpace = false
  while (p < n) {
    const c = codeAt(sql, p)
    if (c === CHAR_SPACE || c === CHAR_TAB) {
      sawSpace = true
      p++
      continue
    }
    break
  }
  if (!sawSpace || p >= n) return null
  const c0 = codeAt(sql, p)
  if (c0 === CHAR_LF || c0 === CHAR_CR) return null
  let tokenEnd = p
  while (tokenEnd < n) {
    const c = codeAt(sql, tokenEnd)
    if (c === CHAR_SPACE || c === CHAR_TAB || c === CHAR_LF || c === CHAR_CR) break
    tokenEnd++
  }
  const token = sql.slice(p, tokenEnd)
  if (!token) return null
  let lineEnd = tokenEnd
  while (lineEnd < n && codeAt(sql, lineEnd) !== CHAR_LF) lineEnd++
  if (lineEnd < n && codeAt(sql, lineEnd) === CHAR_LF) lineEnd++
  return { next: lineEnd, delimiter: token }
}

function matchesDelimiterAt(sql: string, i: number, delim: string): boolean {
  if (!delim) return false
  if (delim === ';') return codeAt(sql, i) === CHAR_SEMI
  const n = sql.length
  const len = delim.length
  if (i + len > n) return false
  for (let k = 0; k < len; k++) {
    if (sql.charCodeAt(i + k) !== delim.charCodeAt(k)) return false
  }
  return true
}

/** 跳过 MySQL `DEFINER = user@host`（失败则原样返回 i）。 */
function skipMysqlDefinerClause(
  sql: string,
  i: number,
  features: SqlSplitFeatures,
): number {
  const n = sql.length
  let p = skipWsAndComments(sql, i, features)
  const defAt = matchKeyword(sql, p, 'definer')
  if (defAt < 0) return i
  p = skipWsAndComments(sql, defAt, features)
  if (p >= n || codeAt(sql, p) !== CHAR_EQ) return i
  p = skipWsAndComments(sql, p + 1, features)
  if (p >= n) return i

  const skipAccountPart = (from: number): number => {
    const c = codeAt(sql, from)
    if (c === CHAR_BACKTICK || c === CHAR_SQUOTE || c === CHAR_DQUOTE) {
      return skipQuotedIdent(sql, from, c)
    }
    if (!isIdentStart(c)) return -1
    let j = from + 1
    while (j < n && isIdentCont(codeAt(sql, j))) j++
    return j
  }

  p = skipAccountPart(p)
  if (p < 0) return i
  p = skipWsAndComments(sql, p, features)
  if (p >= n || codeAt(sql, p) !== CHAR_AT) return i
  p = skipWsAndComments(sql, p + 1, features)
  p = skipAccountPart(p)
  if (p < 0) return i
  return p
}

/**
 * 句首探测：CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER、DECLARE、BEGIN 匿名块。
 * @returns 消费后的下标与模式；非 PL/SQL 句首返回 null
 */
function tryStartPlsql(
  sql: string,
  i: number,
  features: SqlSplitFeatures,
): { next: number; mode: PlsqlMode } | null {
  const beginAt = matchKeyword(sql, i, 'begin')
  if (beginAt >= 0) {
    return { next: beginAt, mode: bodyMode(1, false, 1) }
  }
  const declareAt = matchKeyword(sql, i, 'declare')
  if (declareAt >= 0) {
    return { next: declareAt, mode: bodyMode(0, false, 1) }
  }
  const createAt = matchKeyword(sql, i, 'create')
  if (createAt < 0) return null
  let p = skipWsAndComments(sql, createAt, features)
  const orAt = matchKeyword(sql, p, 'or')
  if (orAt >= 0) {
    p = skipWsAndComments(sql, orAt, features)
    const replaceAt = matchKeyword(sql, p, 'replace')
    if (replaceAt < 0) return null
    p = skipWsAndComments(sql, replaceAt, features)
  }
  // 对齐 oracle-service script_split：跳过 EDITIONABLE / NONEDITIONABLE
  const editionableAt = matchKeyword(sql, p, 'editionable')
  if (editionableAt >= 0) {
    p = skipWsAndComments(sql, editionableAt, features)
  } else {
    const nonEditionableAt = matchKeyword(sql, p, 'noneditionable')
    if (nonEditionableAt >= 0) {
      p = skipWsAndComments(sql, nonEditionableAt, features)
    }
  }
  const procAt = matchKeyword(sql, p, 'procedure')
  if (procAt >= 0) return { next: procAt, mode: { kind: 'await_as_is' } }
  const funcAt = matchKeyword(sql, p, 'function')
  if (funcAt >= 0) return { next: funcAt, mode: { kind: 'await_as_is' } }
  const pkgAt = matchKeyword(sql, p, 'package')
  if (pkgAt >= 0) {
    let after = skipWsAndComments(sql, pkgAt, features)
    const bodyAt = matchKeyword(sql, after, 'body')
    if (bodyAt >= 0) after = bodyAt
    return { next: after, mode: { kind: 'await_as_is' } }
  }
  // 触发器：CREATE TRIGGER … [DECLARE] BEGIN … END;（无 AS/IS）
  const triggerAt = matchKeyword(sql, p, 'trigger')
  if (triggerAt >= 0) return { next: triggerAt, mode: { kind: 'await_begin' } }
  return null
}

/**
 * MySQL 句首：CREATE [DEFINER=…] PROCEDURE|FUNCTION → 等待 BEGIN。
 */
function tryStartMysqlCompound(
  sql: string,
  i: number,
  features: SqlSplitFeatures,
): { next: number; mode: PlsqlMode } | null {
  const createAt = matchKeyword(sql, i, 'create')
  if (createAt < 0) return null
  let p = skipWsAndComments(sql, createAt, features)
  p = skipMysqlDefinerClause(sql, p, features)
  p = skipWsAndComments(sql, p, features)
  const orAt = matchKeyword(sql, p, 'or')
  if (orAt >= 0) {
    p = skipWsAndComments(sql, orAt, features)
    const replaceAt = matchKeyword(sql, p, 'replace')
    if (replaceAt < 0) return null
    p = skipWsAndComments(sql, replaceAt, features)
  }
  // DEFINER 也可能写在 OR REPLACE 之后（少见）；再试一次
  p = skipMysqlDefinerClause(sql, p, features)
  p = skipWsAndComments(sql, p, features)
  const procAt = matchKeyword(sql, p, 'procedure')
  if (procAt >= 0) return { next: procAt, mode: { kind: 'await_begin' } }
  const funcAt = matchKeyword(sql, p, 'function')
  if (funcAt >= 0) return { next: funcAt, mode: { kind: 'await_begin' } }
  // SQLite / MySQL：CREATE TRIGGER … BEGIN … END;（体内分号不拆句）
  const triggerAt = matchKeyword(sql, p, 'trigger')
  if (triggerAt >= 0) return { next: triggerAt, mode: { kind: 'await_begin' } }
  return null
}

function isEndBlockCloser(sql: string, afterEnd: number, features: SqlSplitFeatures): boolean {
  const p = skipWsAndComments(sql, afterEnd, features)
  return (
    matchKeyword(sql, p, 'if') >= 0 ||
    matchKeyword(sql, p, 'loop') >= 0 ||
    matchKeyword(sql, p, 'case') >= 0 ||
    matchKeyword(sql, p, 'while') >= 0 ||
    matchKeyword(sql, p, 'repeat') >= 0
  )
}

const CHAR_LBRACKET = 91
const CHAR_RBRACKET = 93

/** 跳过 `[ident]`；`]` 内 `]]` 为转义。返回闭合 `]` 之后下标。 */
function skipBracketIdent(sql: string, openBracket: number): number {
  const n = sql.length
  let i = openBracket + 1
  while (i < n) {
    const c = codeAt(sql, i)
    if (c === CHAR_RBRACKET) {
      if (i + 1 < n && codeAt(sql, i + 1) === CHAR_RBRACKET) {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return n
}

/**
 * 独立行 `GO`（可选 `GO <n>`）：该行除空白外以 GO 开头，其后仅空白或行尾。
 * @returns 吃掉整行后的下标；不匹配返回 -1
 */
function matchStandaloneGoLine(sql: string, i: number): number {
  const goEnd = matchKeyword(sql, i, 'go')
  if (goEnd < 0) return -1
  const n = sql.length
  let p = goEnd
  // 可选批次数：GO 5
  if (p < n && codeAt(sql, p) === CHAR_SPACE) {
    p++
    while (p < n) {
      const c = codeAt(sql, p)
      if (c >= CHAR_0 && c <= CHAR_9) {
        p++
        continue
      }
      break
    }
  }
  while (p < n) {
    const c = codeAt(sql, p)
    if (c === CHAR_SPACE || c === CHAR_TAB) {
      p++
      continue
    }
    if (c === CHAR_CR || c === CHAR_LF) break
    return -1
  }
  if (p < n && codeAt(sql, p) === CHAR_CR) p++
  if (p < n && codeAt(sql, p) === CHAR_LF) p++
  return p
}

function isPhysicalLineStart(sql: string, i: number): boolean {
  if (i <= 0) return true
  const prev = codeAt(sql, i - 1)
  return prev === CHAR_LF || prev === CHAR_CR
}

/**
 * T-SQL `GO` 批边界：批内不分号；`GO` 行本身不进入可执行切片。
 */
function findGoBatchBoundaries(
  sql: string,
  features: SqlSplitFeatures,
  options: Pick<SplitSqlOptions, 'standardConformingStrings'> = {},
): StatementBoundary[] {
  const positions: StatementBoundary[] = []
  const n = sql.length
  const scs = options.standardConformingStrings !== false
  let i = 0
  while (i < n) {
    const c = codeAt(sql, i)
    const c1 = i + 1 < n ? codeAt(sql, i + 1) : 0
    if (c === CHAR_SQUOTE) {
      const escapePrefixed = features.postgresEscapeStringPrefix && hasPostgresEscapePrefix(sql, i)
      const backslash = features.backslashStringEscapes || escapePrefixed || !scs
      i = skipSingleQuoted(sql, i, backslash)
      continue
    }
    if (c === CHAR_DQUOTE) {
      i = skipQuotedIdent(sql, i, CHAR_DQUOTE)
      continue
    }
    if (features.backticks && c === CHAR_BACKTICK) {
      i = skipQuotedIdent(sql, i, CHAR_BACKTICK)
      continue
    }
    if (features.bracketIdentifiers && c === CHAR_LBRACKET) {
      i = skipBracketIdent(sql, i)
      continue
    }
    if (c === CHAR_DASH && c1 === CHAR_DASH) {
      i = skipLineComment(sql, i + 2)
      continue
    }
    if (c === CHAR_SLASH && c1 === CHAR_STAR) {
      i = skipBlockComment(sql, i, features.nestedBlockComments)
      continue
    }
    if (features.hashLineComments && c === CHAR_HASH) {
      i = skipLineComment(sql, i + 1)
      continue
    }
    if (isPhysicalLineStart(sql, i)) {
      let p = i
      while (p < n && (codeAt(sql, p) === CHAR_SPACE || codeAt(sql, p) === CHAR_TAB)) p++
      const goNext = matchStandaloneGoLine(sql, p)
      if (goNext >= 0) {
        positions.push({
          end: i,
          delimiterIndex: i,
          delimiterLength: goNext - i,
        })
        i = goNext
        continue
      }
    }
    i++
  }
  return positions
}

/**
 * 扫描语句边界（分号、独立行 `/`、或 MySQL DELIMITER 自定义结束符）。
 * PL/SQL 体结束处的 `;` 会计入切片（`END;` 的分号是过程体语法，不能剥掉）。
 * `goBatches` 时改走独立行 `GO` 批边界。
 */
function findStatementBoundaries(
  sql: string,
  features: SqlSplitFeatures,
  options: Pick<SplitSqlOptions, 'standardConformingStrings'> = {},
): StatementBoundary[] {
  if (features.goBatches) {
    return findGoBatchBoundaries(sql, features, options)
  }
  const positions: StatementBoundary[] = []
  const n = sql.length
  const scs = options.standardConformingStrings !== false
  let i = 0
  let atStatementStart = true
  let plsql: PlsqlMode = { kind: 'off' }
  let currentDelimiter = ';'

  const pushSemi = (semi: number, includeSemi: boolean) => {
    positions.push({
      end: includeSemi ? semi + 1 : semi,
      delimiterIndex: semi,
      delimiterLength: 1,
    })
  }

  while (i < n) {
    if (features.delimiterBlocks && atStatementStart) {
      const skipped = skipWsAndComments(sql, i, features)
      if (skipped !== i) {
        i = skipped
        continue
      }
      const delimDir = tryParseDelimiterDirective(sql, i)
      if (delimDir) {
        // 指令行本身不输出：用 delimiterLength 吃掉整行
        positions.push({
          end: i,
          delimiterIndex: i,
          delimiterLength: delimDir.next - i,
        })
        currentDelimiter = delimDir.delimiter
        i = delimDir.next
        atStatementStart = true
        continue
      }
      // 非 DELIMITER 指令：若无复合句首探测，立刻离开句首态，避免把中间标识符当成指令
      if (!usesCompoundBody(features)) {
        atStatementStart = false
      }
    }

    if (usesCompoundBody(features) && atStatementStart) {
      const skipped = skipWsAndComments(sql, i, features)
      if (skipped !== i) {
        i = skipped
        continue
      }
      if (
        features.plsqlBlocks &&
        codeAt(sql, i) === CHAR_SLASH &&
        isSlashTerminatorAt(sql, i)
      ) {
        // 上一句 END; 后残留的 gsql `/`，或空缓冲：记边界，空段随后被丢掉
        positions.push({ end: i, delimiterIndex: i, delimiterLength: 1 })
        i = advancePastSlashLine(sql, i)
        atStatementStart = true
        plsql = { kind: 'off' }
        continue
      }
      if (features.mysqlCompoundBlocks) {
        const mysqlStarted = tryStartMysqlCompound(sql, i, features)
        if (mysqlStarted) {
          plsql = mysqlStarted.mode
          i = mysqlStarted.next
          atStatementStart = false
          continue
        }
      }
      if (features.plsqlBlocks) {
        const started = tryStartPlsql(sql, i, features)
        if (started) {
          plsql = started.mode
          i = started.next
          atStatementStart = false
          continue
        }
      }
      atStatementStart = false
    }

    const c = codeAt(sql, i)
    const c1 = i + 1 < n ? codeAt(sql, i + 1) : 0

    // -- 行注释
    if (c === CHAR_DASH && c1 === CHAR_DASH) {
      i = skipLineComment(sql, i + 2)
      continue
    }

    // MySQL #
    if (features.hashLineComments && c === CHAR_HASH) {
      i = skipLineComment(sql, i + 1)
      continue
    }

    // /* … */
    if (c === CHAR_SLASH && c1 === CHAR_STAR) {
      i = skipBlockComment(sql, i, features.nestedBlockComments)
      continue
    }

    // 独立行 `/`：PL/SQL 体结束符（不把 `/` 计入切片）
    if (
      features.plsqlBlocks &&
      plsql.kind === 'body' &&
      c === CHAR_SLASH &&
      isSlashTerminatorAt(sql, i)
    ) {
      positions.push({ end: i, delimiterIndex: i, delimiterLength: 1 })
      i = advancePastSlashLine(sql, i)
      plsql = { kind: 'off' }
      atStatementStart = true
      continue
    }

    // Oracle q'…'
    if (
      features.oracleQQuotes &&
      (c === 113 || c === 81) && // q Q
      c1 === CHAR_SQUOTE &&
      i + 2 < n &&
      (i === 0 || !isIdentContChar(sql[i - 1]!))
    ) {
      i = skipOracleQQuote(sql, i)
      continue
    }

    // 单引号字符串
    if (c === CHAR_SQUOTE) {
      let backslash = features.backslashStringEscapes
      if (!scs) backslash = true
      if (features.postgresEscapeStringPrefix && hasPostgresEscapePrefix(sql, i)) {
        backslash = true
      }
      i = skipSingleQuoted(sql, i, backslash)
      continue
    }

    // 双引号标识符
    if (c === CHAR_DQUOTE) {
      i = skipQuotedIdent(sql, i, CHAR_DQUOTE)
      continue
    }

    // MySQL 反引号
    if (features.backticks && c === CHAR_BACKTICK) {
      i = skipQuotedIdent(sql, i, CHAR_BACKTICK)
      continue
    }

    // Dollar-quote（非法 `$…` 开头时只前进一步）
    if (features.dollarQuotes && c === CHAR_DOLLAR) {
      i = skipDollarQuote(sql, i)
      continue
    }

    // 复合语句关键字：AS/IS 或 BEGIN 切入体；BEGIN/END 嵌套
    if (usesCompoundBody(features) && isIdentStart(c)) {
      if (features.plsqlBlocks && plsql.kind === 'await_as_is') {
        let asIsEnd = matchKeyword(sql, i, 'as')
        if (asIsEnd < 0) asIsEnd = matchKeyword(sql, i, 'is')
        if (asIsEnd >= 0) {
          const peek = skipWsAndComments(sql, asIsEnd, features)
          const pc = peek < n ? codeAt(sql, peek) : 0
          if (pc === CHAR_DOLLAR || pc === CHAR_SQUOTE) {
            // PG / 字符串函数体：交由 dollar-quote / 单引号路径处理
            plsql = { kind: 'off' }
            i = asIsEnd
            continue
          }
          plsql = bodyMode(0, false, 1)
          i = asIsEnd
          continue
        }
      }
      if (features.mysqlCompoundBlocks && plsql.kind === 'await_begin') {
        const beginAt = matchKeyword(sql, i, 'begin')
        if (beginAt >= 0) {
          plsql = bodyMode(1, false, 1)
          i = beginAt
          continue
        }
      }
      // Oracle/Dameng 触发器等：await_begin，可先 DECLARE 再 BEGIN
      if (features.plsqlBlocks && plsql.kind === 'await_begin') {
        const declareAt = matchKeyword(sql, i, 'declare')
        if (declareAt >= 0) {
          plsql = bodyMode(0, false, 1)
          i = declareAt
          continue
        }
        const beginAt = matchKeyword(sql, i, 'begin')
        if (beginAt >= 0) {
          plsql = bodyMode(1, false, 1)
          i = beginAt
          continue
        }
      }
      if (plsql.kind === 'body') {
        // 声明段 / 包体内嵌套子程序：PROCEDURE log … IS BEGIN … END;
        const nestedProc = matchKeyword(sql, i, 'procedure')
        const nestedFunc = nestedProc < 0 ? matchKeyword(sql, i, 'function') : -1
        if (nestedProc >= 0 || nestedFunc >= 0) {
          plsql = bodyMode(
            plsql.beginDepth,
            false,
            plsql.routineDepth + 1,
            plsql.caseDepth,
          )
          i = nestedProc >= 0 ? nestedProc : nestedFunc
          continue
        }
        const caseAt = matchKeyword(sql, i, 'case')
        if (caseAt >= 0) {
          plsql = bodyMode(
            plsql.beginDepth,
            false,
            plsql.routineDepth,
            plsql.caseDepth + 1,
          )
          i = caseAt
          continue
        }
        const beginEnd = matchKeyword(sql, i, 'begin')
        if (beginEnd >= 0) {
          plsql = bodyMode(
            plsql.beginDepth + 1,
            false,
            plsql.routineDepth,
            plsql.caseDepth,
          )
          i = beginEnd
          continue
        }
        const endEnd = matchKeyword(sql, i, 'end')
        if (endEnd >= 0) {
          if (isEndBlockCloser(sql, endEnd, features)) {
            // END IF / END LOOP / END CASE / …
            let caseDepth = plsql.caseDepth
            const after = skipWsAndComments(sql, endEnd, features)
            if (matchKeyword(sql, after, 'case') >= 0 && caseDepth > 0) {
              caseDepth -= 1
            }
            plsql = bodyMode(
              plsql.beginDepth,
              false,
              plsql.routineDepth,
              caseDepth,
            )
          } else if (plsql.caseDepth > 0) {
            // CASE 表达式：… END（无 CASE 关键字后缀）
            plsql = bodyMode(
              plsql.beginDepth,
              false,
              plsql.routineDepth,
              plsql.caseDepth - 1,
            )
          } else {
            const depth = Math.max(0, plsql.beginDepth - 1)
            let routineDepth = plsql.routineDepth
            let endPending = false
            if (depth === 0) {
              if (routineDepth > 1) {
                // 嵌套子程序结束，回到外层声明段 / 外层体
                routineDepth -= 1
              } else {
                endPending = true
              }
            }
            plsql = bodyMode(depth, endPending, routineDepth, 0)
          }
          i = endEnd
          continue
        }
      }
    }

    // MySQL 自定义 DELIMITER（非 `;`）：字面匹配，字符串/注释外才生效
    if (
      features.delimiterBlocks &&
      currentDelimiter !== ';' &&
      matchesDelimiterAt(sql, i, currentDelimiter)
    ) {
      positions.push({
        end: i,
        delimiterIndex: i,
        delimiterLength: currentDelimiter.length,
      })
      i += currentDelimiter.length
      plsql = { kind: 'off' }
      atStatementStart = true
      continue
    }

    if (c === CHAR_SEMI) {
      if (features.delimiterBlocks && currentDelimiter !== ';') {
        // 过程体内分号：当前分隔符不是 `;`，不拆
        i++
        continue
      }
      if (usesCompoundBody(features) && plsql.kind === 'body') {
        if (plsql.endPending && plsql.beginDepth === 0) {
          // END; —— 分号属于过程体，必须保留在切片内
          pushSemi(i, true)
          plsql = { kind: 'off' }
          atStatementStart = true
          i++
          continue
        }
        // DECLARE 段或 BEGIN 体内的语句分号：不拆
        i++
        continue
      }
      if (plsql.kind === 'await_as_is' || plsql.kind === 'await_begin') {
        plsql = { kind: 'off' }
      }
      pushSemi(i, false)
      atStatementStart = true
      i++
      continue
    }

    i++
  }

  return positions
}

/**
 * 扫描语句分隔分号的下标（不含字符串/注释内的 `;`）。
 * 含 PL/SQL 结束分号与独立行 `/` 的下标（与历史 API 兼容）。
 */
export function findStatementSemicolons(
  sql: string,
  features: SqlSplitFeatures,
  options: Pick<SplitSqlOptions, 'standardConformingStrings'> = {},
): number[] {
  return findStatementBoundaries(sql, features, options).map((b) => b.delimiterIndex)
}

function trimBounds(sql: string, from: number, to: number): { start: number; end: number } {
  let start = from
  let end = to
  while (start < end && isWs(codeAt(sql, start))) start++
  while (end > start && isWs(codeAt(sql, end - 1))) end--
  return { start, end }
}

function sliceHasSql(sql: string, from: number, to: number): boolean {
  let i = from
  while (i < to) {
    const c = codeAt(sql, i)
    const c1 = i + 1 < to ? codeAt(sql, i + 1) : 0
    if (isWs(c)) {
      i++
      continue
    }
    if (c === CHAR_DASH && c1 === CHAR_DASH) {
      i = skipLineComment(sql, i + 2)
      if (i > to) i = to
      continue
    }
    if (c === CHAR_SLASH && c1 === CHAR_STAR) {
      i = skipBlockComment(sql, i, true)
      if (i > to) i = to
      continue
    }
    if (c === CHAR_HASH) {
      i = skipLineComment(sql, i + 1)
      if (i > to) i = to
      continue
    }
    // 孤立 `/` 不算有效 SQL
    if (c === CHAR_SLASH && isSlashTerminatorAt(sql, i)) {
      i = advancePastSlashLine(sql, i)
      if (i > to) i = to
      continue
    }
    return true
  }
  return false
}

function buildSlices(
  sql: string,
  boundaries: StatementBoundary[],
  keepEmpty: boolean,
): SqlStatementSlice[] {
  const out: SqlStatementSlice[] = []
  let start = 0
  let index = 0

  const pushRange = (rawStart: number, rawEnd: number, semicolonIndex: number) => {
    if (!keepEmpty && !sliceHasSql(sql, rawStart, rawEnd)) return
    const { start: s, end: e } = trimBounds(sql, rawStart, rawEnd)
    if (!keepEmpty && s >= e) return
    // trim 后若只剩 `/`，丢弃
    if (!keepEmpty && s < e && sql.slice(s, e).trim() === '/') return
    out.push({
      index,
      sql: sql.slice(s, e),
      start: s,
      end: e,
      semicolonIndex,
    })
    index++
  }

  for (let k = 0; k < boundaries.length; k++) {
    const b = boundaries[k]!
    pushRange(start, b.end, b.delimiterIndex)
    // 下一句从分隔符之后开始（若 end 已含 `;`，则从 end 起；若 end 在 `/` 前，从 delimiter+len）
    start = Math.max(b.end, b.delimiterIndex + (b.delimiterLength || 1))
  }
  if (start <= sql.length) {
    pushRange(start, sql.length, -1)
  }
  return out
}

/**
 * 按方言拆分多语句 SQL。
 *
 * @example
 * splitSqlStatements("SELECT 1; SELECT 2", "vastbase")
 * // → [{ sql: "SELECT 1", … }, { sql: "SELECT 2", … }]
 */
export function splitSqlStatements(
  sql: string,
  dialect: SqlDialect = 'generic',
  options: SplitSqlOptions = {},
): SqlStatementSlice[] {
  const features = resolveSqlSplitFeatures(dialect)
  return splitSqlStatementsWithFeatures(sql, features, options)
}

/** 供测试 / 自定义词法：直接指定能力位。 */
export function splitSqlStatementsWithFeatures(
  sql: string,
  features: SqlSplitFeatures,
  options: SplitSqlOptions = {},
): SqlStatementSlice[] {
  return buildSlices(
    sql,
    findStatementBoundaries(sql, features, options),
    options.keepEmpty === true,
  )
}

/** 仅返回 trim 后的语句文本列表（批量执行最常用）。 */
export function splitSqlTexts(
  sql: string,
  dialect: SqlDialect = 'generic',
  options?: SplitSqlOptions,
): string[] {
  return splitSqlStatements(sql, dialect, options).map((s) => s.sql)
}
