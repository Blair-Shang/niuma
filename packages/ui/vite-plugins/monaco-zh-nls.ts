/**
 * Vite 插件：将 Monaco Editor 0.55 内置的官方中文 NLS 消息注入到
 * `nls.messages.js` 模块，使编辑器右键菜单、命令面板等 UI 显示中文。
 *
 * Monaco 0.55 ESM 编译产物中 localize() 使用数字索引，需要设置
 * globalThis._VSCODE_NLS_MESSAGES 数组才能生效。
 * Monaco 自带 min/vs/nls.messages.zh-cn.js.js，提供完整的官方中文翻译。
 *
 * 两阶段拦截：
 *  1. config hook + rolldown plugin → 覆盖 Vite 8 optimizeDeps 预构建阶段
 *  2. Rollup load hook              → 覆盖生产构建 / 非预构建 dev 场景
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import type { Plugin } from 'vite'

function extractZhCnMessages(): string {
  try {
    const require = createRequire(import.meta.url)
    const zhCnPath = require.resolve('monaco-editor/min/vs/nls.messages.zh-cn.js.js')
    const raw = readFileSync(zhCnPath, 'utf8')

    const start = raw.indexOf('_VSCODE_NLS_MESSAGES=[')
    if (start === -1) return ''

    const arrStart = raw.indexOf('[', start)
    let depth = 0
    let arrEnd = -1
    for (let i = arrStart; i < raw.length; i++) {
      if (raw[i] === '[') depth++
      else if (raw[i] === ']') {
        depth--
        if (depth === 0) {
          arrEnd = i
          break
        }
      }
    }
    return arrEnd !== -1 ? raw.slice(arrStart, arrEnd + 1) : ''
  } catch (e) {
    console.warn('[monaco-zh-nls] 无法加载 Monaco 官方中文 NLS:', e)
    return ''
  }
}

export function monacoZhNlsPlugin(): Plugin {
  const messagesCode = extractZhCnMessages()

  if (!messagesCode) {
    console.warn('[monaco-zh-nls] 中文 NLS 数组提取失败，跳过插件')
    return { name: 'monaco-zh-nls' }
  }

  const nlsModuleCode = `
/* monaco-zh-nls: Monaco 0.55 官方中文翻译 */
globalThis._VSCODE_NLS_MESSAGES = ${messagesCode};
globalThis._VSCODE_NLS_LANGUAGE = 'zh-cn';
export function getNLSMessages() { return globalThis._VSCODE_NLS_MESSAGES; }
export function getNLSLanguage() { return globalThis._VSCODE_NLS_LANGUAGE; }
`

  const nlsFileFilter = /monaco-editor[/\\]esm[/\\]vs[/\\]nls\.messages\.js$/

  /** rolldown plugin —— 用于 Vite 8 optimizeDeps 预构建阶段 */
  const rolldownPlugin = {
    name: 'monaco-zh-nls-rolldown',
    load(id: string) {
      if (nlsFileFilter.test(id)) {
        return nlsModuleCode
      }
      return undefined
    },
  }

  return {
    name: 'monaco-zh-nls',
    enforce: 'pre',

    /**
     * 将 rolldown plugin 注入到 optimizeDeps，覆盖 Vite 8 开发模式预构建阶段。
     * Monaco 没有 "type":"module"，Vite 会用 rolldown 预构建它，
     * 此时需要通过 rolldownOptions.plugins 拦截。
     */
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [rolldownPlugin],
          },
        },
      }
    },

    /** Rollup load hook —— 用于生产构建 / SSR / 非预构建 dev 场景 */
    load(id: string) {
      if (nlsFileFilter.test(id)) {
        return nlsModuleCode
      }
    },
  }
}
