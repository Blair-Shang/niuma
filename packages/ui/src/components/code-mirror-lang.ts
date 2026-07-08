import type { Extension } from '@codemirror/state'

/** 按语言标识动态加载 CodeMirror 语言扩展 */
export async function resolveCodeMirrorLanguage(lang: string): Promise<Extension[]> {
  const l = lang.toLowerCase().trim()
  try {
    switch (l) {
      case 'js':
      case 'javascript':
      case 'jsx': {
        const { javascript } = await import('@codemirror/lang-javascript')
        return [javascript()]
      }
      case 'ts':
      case 'typescript':
      case 'tsx': {
        const { javascript } = await import('@codemirror/lang-javascript')
        return [javascript({ typescript: true })]
      }
      case 'py':
      case 'python': {
        const { python } = await import('@codemirror/lang-python')
        return [python()]
      }
      case 'go': {
        const { go } = await import('@codemirror/lang-go')
        return [go()]
      }
      case 'html':
      case 'htm': {
        const { html } = await import('@codemirror/lang-html')
        return [html()]
      }
      case 'css':
      case 'scss':
      case 'less': {
        const { css } = await import('@codemirror/lang-css')
        return [css()]
      }
      case 'json':
      case 'jsonc': {
        const { json } = await import('@codemirror/lang-json')
        return [json()]
      }
      case 'sql': {
        const { sql } = await import('@codemirror/lang-sql')
        return [sql()]
      }
      case 'rust':
      case 'rs': {
        const { rust } = await import('@codemirror/lang-rust')
        return [rust()]
      }
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'c': {
        const { cpp } = await import('@codemirror/lang-cpp')
        return [cpp()]
      }
      case 'java': {
        const { java } = await import('@codemirror/lang-java')
        return [java()]
      }
      case 'md':
      case 'markdown': {
        const { markdown } = await import('@codemirror/lang-markdown')
        return [markdown()]
      }
      case 'xml':
      case 'svg': {
        const { xml } = await import('@codemirror/lang-xml')
        return [xml()]
      }
      case 'yaml':
      case 'yml': {
        const { yaml } = await import('@codemirror/lang-yaml')
        return [yaml()]
      }
      case 'vue': {
        const { html } = await import('@codemirror/lang-html')
        return [html()]
      }
      case 'sh':
      case 'bash':
      case 'shell':
      case 'zsh': {
        const [{ StreamLanguage }, { shell }] = await Promise.all([
          import('@codemirror/language'),
          import('@codemirror/legacy-modes/mode/shell'),
        ])
        return [StreamLanguage.define(shell)]
      }
      default:
        return []
    }
  } catch {
    return []
  }
}

export function isCodeMirrorLightTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.rsTheme === 'light'
}

/** 预加载 CodeMirror 核心与目标语言包（供辅助窗口 reveal 前调用） */
export async function prewarmCodeMirrorEditor(language: string): Promise<void> {
  await Promise.all([import('codemirror'), resolveCodeMirrorLanguage(language)])
}
