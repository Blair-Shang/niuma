/** MongoDB Shell 专用 Monaco 语言（避免走未配置完整的 JS/TS Language Service）。 */
export const MONACO_MONGODB_SHELL_LANGUAGE = 'mongodb-shell'

let registered = false

/**
 * 注册 mongodb-shell：JS 风格着色与括号，不挂 TypeScript Worker。
 * Shell 补全由 completionRequest 提供，与内置 TS 补全隔离。
 */
export function ensureMongodbShellLanguage(monaco: typeof import('monaco-editor')): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: MONACO_MONGODB_SHELL_LANGUAGE })
  monaco.languages.setLanguageConfiguration(MONACO_MONGODB_SHELL_LANGUAGE, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
  })

  monaco.languages.setMonarchTokensProvider(MONACO_MONGODB_SHELL_LANGUAGE, {
    defaultToken: '',
    tokenPostfix: '.mongodb-shell',
    keywords: [
      'db',
      'use',
      'show',
      'help',
      'exit',
      'true',
      'false',
      'null',
      'undefined',
      'function',
      'return',
      'const',
      'let',
      'var',
      'if',
      'else',
      'for',
      'while',
      'new',
      'typeof',
    ],
    typeKeywords: ['ObjectId', 'ISODate', 'NumberLong', 'NumberInt', 'NumberDecimal', 'UUID', 'BinData', 'Timestamp', 'MinKey', 'MaxKey', 'DBRef'],
    operators: ['<=', '>=', '==', '!=', '===', '!==', '=>', '+', '-', '*', '/', '%', '&&', '||', '!', '?', ':', '='],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    tokenizer: {
      root: [
        [/[{}]/, 'delimiter.bracket'],
        [/[[\]]/, 'delimiter.array'],
        [/[()]/, 'delimiter.parenthesis'],
        [/[a-zA-Z_$][\w$]*/, {
          cases: {
            '@typeKeywords': 'type',
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/\$[a-zA-Z_][\w$]*/, 'variable.predefined'],
        [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/\d+/, 'number'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
        [/`/, 'string', '@string_backtick'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/[;,.]/, 'delimiter'],
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        }],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop'],
      ],
      string_single: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop'],
      ],
      string_backtick: [
        [/[^\\`]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/`/, 'string', '@pop'],
      ],
    },
  })
}
