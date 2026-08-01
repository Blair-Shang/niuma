import type { RsCodeEditorLanguage } from '@niuma/ui'

/** 按文件扩展名推断 CodeMirror 语言（未知扩展名回退 plaintext） */
export function detectLanguageFromPath(path: string): RsCodeEditorLanguage {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot < 0) {
    return 'plaintext'
  }
  const ext = base.slice(dot + 1).toLowerCase()
  const map: Record<string, RsCodeEditorLanguage> = {
    go: 'go',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    vue: 'vue',
    py: 'python',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    sh: 'shell',
    bash: 'shell',
    json: 'json',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    xsd: 'xml',
    xsl: 'xml',
    xslt: 'xml',
    css: 'css',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    md: 'markdown',
  }
  return map[ext] ?? 'plaintext'
}

/** 从路径取展示用文件名 */
export function basenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
