export type RsCodeEditorLanguage =
  | 'plaintext'
  | 'json'
  | 'typescript'
  | 'javascript'
  | 'css'
  | 'html'
  | 'sql'
  | 'go'
  | 'python'
  | 'rust'
  | 'java'
  | 'cpp'
  | 'c'
  | 'shell'
  | 'yaml'
  | 'toml'
  | 'markdown'
  | 'vue'

export type RsCodeEditorTheme = 'auto' | 'light' | 'dark'
export type RsResolvedCodeEditorTheme = 'light' | 'dark'

export interface RsCodeEditorDiagnostic {
  message: string
  line?: number
  column?: number
  severity?: 'error' | 'warning' | 'info'
}

/** CodeMirror SQL 字段/表补全（对应 @codemirror/lang-sql SQLConfig 子集） */
export type RsCodeEditorSqlDialect = 'postgresql' | 'standard' | 'mysql'

export interface RsCodeEditorSqlColumn {
  label: string
  /** 展示用类型，如 integer / text */
  detail?: string
  type?: string
  boost?: number
}

export type RsCodeEditorSqlNamespace =
  | readonly (string | RsCodeEditorSqlColumn)[]
  | { [name: string]: RsCodeEditorSqlNamespace }

export interface RsCodeEditorSqlConfig {
  dialect?: RsCodeEditorSqlDialect
  schema?: RsCodeEditorSqlNamespace
  /** 顶层直接补全该表列（适合 WHERE 片段） */
  defaultTable?: string
  defaultSchema?: string
}

const SUPPORTED_LANGUAGES: RsCodeEditorLanguage[] = [
  'plaintext', 'json', 'typescript', 'javascript', 'css', 'html', 'sql',
  'go', 'python', 'rust', 'java', 'cpp', 'c', 'shell', 'yaml', 'toml', 'markdown', 'vue',
]

/** 语言 → 工具栏展示名称映射 */
const LANGUAGE_DISPLAY_NAME: Record<RsCodeEditorLanguage, string> = {
  plaintext: 'Plain Text',
  json: 'JSON',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  css: 'CSS',
  html: 'HTML',
  sql: 'SQL',
  go: 'Go',
  python: 'Python',
  rust: 'Rust',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  shell: 'Shell',
  yaml: 'YAML',
  toml: 'TOML',
  markdown: 'Markdown',
  vue: 'Vue',
}

export function resolveCodeEditorLanguage(language?: string): RsCodeEditorLanguage {
  return (SUPPORTED_LANGUAGES as string[]).includes(language ?? '')
    ? (language as RsCodeEditorLanguage)
    : 'plaintext'
}

export function codeEditorLanguageLabel(language?: string): string {
  const lang = resolveCodeEditorLanguage(language)
  return LANGUAGE_DISPLAY_NAME[lang] ?? lang
}

export function readDocumentTheme(): RsResolvedCodeEditorTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.rsTheme === 'light' ? 'light' : 'dark'
}

export function resolveCodeEditorTheme(theme: RsCodeEditorTheme = 'auto'): RsResolvedCodeEditorTheme {
  return theme === 'auto' ? readDocumentTheme() : theme
}

export function resolveCodeEditorSize(height?: number | string): string {
  if (height === undefined) return '20rem'
  return typeof height === 'number' ? `${height}px` : height
}
