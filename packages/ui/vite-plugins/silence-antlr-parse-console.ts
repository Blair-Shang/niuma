import type { Plugin } from 'vite'

/**
 * 静默 antlr4ng ConsoleErrorListener 的 parse 刷屏。
 *
 * dt-sql-parser 在补全路径 `createParser(input)` 未传 errorListener 时，
 * 不会 `removeErrorListeners()`，半成品 SQL 的 syntaxError 会打满 DevTools。
 * 真实诊断改走 Monaco markers（pgsql diagnostics）。
 */
export function silenceAntlrParseConsole(): Plugin {
  return {
    name: 'silence-antlr-parse-console',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/')
      if (!normalized.includes('antlr4ng')) return null
      if (!code.includes('ConsoleErrorListener')) return null
      if (!code.includes('console.error("line "')) return null

      return {
        code: code.replace(
          /console\.error\("line " \+ line \+ ":" \+ charPositionInLine \+ " " \+ msg\);/g,
          '/* parse → Monaco markers; skip console spam */',
        ),
        map: null,
      }
    },
  }
}
