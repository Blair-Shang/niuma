import type { SqlDialect } from '../dialect'

/** 单条语句切片（供批量执行 / 预览 / 选区对齐）。 */
export interface SqlStatementSlice {
  /** 0-based 序号 */
  index: number
  /** trim 后的语句文本（不含结尾分号） */
  sql: string
  /** 在原文中的起始下标（语句首非空白） */
  start: number
  /** 在原文中的结束下标（不含结尾分号、不含尾空白） */
  end: number
  /** 结尾分号下标；无分号（最后一段）为 -1 */
  semicolonIndex: number
}

/** 拆句选项。 */
export interface SplitSqlOptions {
  /**
   * 是否保留「仅空白 / 仅注释」的空段。
   * 默认 false（与 DBeaver / Neon 编辑器一致）。
   */
  keepEmpty?: boolean
  /**
   * PostgreSQL `standard_conforming_strings`。
   * true（默认）：普通 `'…'` 仅 `''` 转义；`E'…'` / `U&'…'` 仍认反斜杠。
   * false：普通串也认 `\`（旧库兼容）。
   */
  standardConformingStrings?: boolean
}

/**
 * 方言词法能力（拆句用）。
 * 新增方言时优先扩展此表，避免在扫描器里堆 `if (dialect === …)`。
 */
export interface SqlSplitFeatures {
  /** PostgreSQL / Vastbase `$tag$…$tag$` */
  dollarQuotes: boolean
  /** MySQL `` `ident` `` */
  backticks: boolean
  /** MySQL `#` 行注释 */
  hashLineComments: boolean
  /** 块注释是否允许嵌套（PG 系） */
  nestedBlockComments: boolean
  /** Oracle `q'[…]'` / `q'!…!'` 等 */
  oracleQQuotes: boolean
  /**
   * 单引号串默认是否认 `\` 转义（MySQL 默认开；PG 由 standardConformingStrings 决定）。
   */
  backslashStringEscapes: boolean
  /**
   * 识别 `E'…'` / `e'…'` / `U&'…'` 前缀串（PG），此类始终认 `\`。
   */
  postgresEscapeStringPrefix: boolean
  /**
   * 识别裸 PL/SQL 体（CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER …、或 DECLARE/BEGIN 匿名块）。
   * 体内 `;` 不拆句；可选独立行 `/` 作结束符（gsql / SQL\*Plus）。
   */
  plsqlBlocks: boolean
  /**
   * 识别 MySQL 客户端 `DELIMITER <token>` 指令：切换语句结束符；
   * 指令行本身不作为可执行语句输出。
   */
  delimiterBlocks: boolean
  /**
   * MySQL 复合语句：`CREATE PROCEDURE|FUNCTION … BEGIN…END;` 体内 `;` 不拆句
   *（对齐 Navicat：编辑器无需手写 DELIMITER；仍兼容 delimiterBlocks）。
   */
  mysqlCompoundBlocks: boolean
}

/** 按产品方言解析拆句词法能力。 */
export function resolveSqlSplitFeatures(dialect: SqlDialect): SqlSplitFeatures {
  switch (dialect) {
    case 'vastbase':
    case 'kingbase':
      return {
        dollarQuotes: true,
        backticks: false,
        hashLineComments: false,
        nestedBlockComments: true,
        oracleQQuotes: true,
        backslashStringEscapes: false,
        postgresEscapeStringPrefix: true,
        plsqlBlocks: true,
        delimiterBlocks: false,
        mysqlCompoundBlocks: false,
      }
    case 'postgresql':
      return {
        dollarQuotes: true,
        backticks: false,
        hashLineComments: false,
        nestedBlockComments: true,
        oracleQQuotes: false,
        backslashStringEscapes: false,
        postgresEscapeStringPrefix: true,
        // PG 过程体通常包在 $$ 内；裸 BEGIN…END 较少，仍开启以兼容 DO 外脚本
        plsqlBlocks: true,
        delimiterBlocks: false,
        mysqlCompoundBlocks: false,
      }
    case 'mysql':
      return {
        dollarQuotes: false,
        backticks: true,
        hashLineComments: true,
        nestedBlockComments: false,
        oracleQQuotes: false,
        backslashStringEscapes: true,
        postgresEscapeStringPrefix: false,
        plsqlBlocks: false,
        delimiterBlocks: true,
        mysqlCompoundBlocks: true,
      }
    case 'oracle':
    case 'dameng':
      return {
        dollarQuotes: false,
        backticks: false,
        hashLineComments: false,
        nestedBlockComments: false,
        oracleQQuotes: true,
        backslashStringEscapes: false,
        postgresEscapeStringPrefix: false,
        plsqlBlocks: true,
        delimiterBlocks: false,
        mysqlCompoundBlocks: false,
      }
    case 'clickhouse':
      return {
        dollarQuotes: false,
        backticks: true,
        hashLineComments: false,
        nestedBlockComments: false,
        oracleQQuotes: false,
        backslashStringEscapes: true,
        postgresEscapeStringPrefix: false,
        plsqlBlocks: false,
        delimiterBlocks: false,
        mysqlCompoundBlocks: false,
      }
    case 'sqlite':
      return {
        dollarQuotes: false,
        backticks: false,
        hashLineComments: false,
        nestedBlockComments: false,
        oracleQQuotes: false,
        backslashStringEscapes: false,
        postgresEscapeStringPrefix: false,
        plsqlBlocks: false,
        delimiterBlocks: false,
        // CREATE TRIGGER … BEGIN…END 体内不分句（对齐 docs/27 split.sqlite_trigger）
        mysqlCompoundBlocks: true,
      }
    case 'sqlserver':
    case 'generic':
    default:
      return {
        dollarQuotes: false,
        backticks: false,
        hashLineComments: false,
        nestedBlockComments: false,
        oracleQQuotes: false,
        backslashStringEscapes: false,
        postgresEscapeStringPrefix: false,
        plsqlBlocks: false,
        delimiterBlocks: false,
        mysqlCompoundBlocks: false,
      }
  }
}
