import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { monacoZhNlsPlugin } from '@niuma/ui/vite-plugins/monaco-zh-nls'
import { niumaUiHost } from '@niuma/ui/vite-plugins/niuma-ui-host'
import { silenceAntlrParseConsole } from '@niuma/ui/vite-plugins/silence-antlr-parse-console'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { serveMonorepoPlugins } from './vite-plugins/serve-monorepo-plugins'

/**
 * 仅包含 @niuma/web 可直接 resolve 的依赖。
 * CodeMirror / xterm 由 @niuma/ui/vite-prebundle/* 作为 optimize 入口预构建
 *（它们装在 niuma-ui 下，web 无法直接 resolve，不能写进 include）。
 * Monaco 不放进 include：整包预构建过重，且会拖慢 / 卡住 dev server 启动；
 * Schema 面板已对 Validator（RsMonacoEditor）做按需异步加载，避免首开 Tab 触发重优化。
 */
const CORE_OPTIMIZE_DEPS = ['vue', 'vue-router', 'pinia', 'vue-i18n', 'echarts', 'vue-echarts'] as const

const require = createRequire(import.meta.url)
const UI_ROOT = dirname(require.resolve('@niuma/ui/package.json'))
const UI_SRC = resolve(UI_ROOT, 'src')

/**
 * 解析 niuma-ui 预构建入口：本机有 src 时走源码，否则走包导出。
 */
function resolveUiPrebundle(kind: 'codemirror' | 'xterm'): string {
  const file = kind === 'codemirror' ? 'vite-codemirror-deps.ts' : 'vite-xterm-deps.ts'
  const src = resolve(UI_SRC, 'dev', file)
  if (existsSync(src)) return src
  return require.resolve(`@niuma/ui/vite-prebundle/${kind}`)
}

function resolveUiWarmup(relFromSrc: string): string | undefined {
  const src = resolve(UI_SRC, relFromSrc)
  if (existsSync(src)) return src
  const dist = resolve(UI_ROOT, 'dist', relFromSrc.replace(/\.vue$/, '.js').replace(/\.ts$/, '.js'))
  return existsSync(dist) ? dist : undefined
}

/**
 * niumaUiHost：dev 联调用到的组件源码；build / 安装包走 npm dist。
 * 不要把 @niuma/ui 别名到 src/index.ts。
 */
export default defineConfig(() => {
  const prebundleEntries = [
    resolveUiPrebundle('codemirror'),
    resolveUiPrebundle('xterm'),
    resolveUiWarmup('components/RsCodeEditor.vue'),
  ].filter((p): p is string => Boolean(p))

  return {
  plugins: [
    vue(),
    tailwindcss(),
    serveMonorepoPlugins(resolve(__dirname, '../plugins')),
    monacoZhNlsPlugin(),
    ...niumaUiHost(),
    silenceAntlrParseConsole(),
  ],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    dedupe: ['monaco-editor', 'monaco-sql-languages'],
  },
  optimizeDeps: {
    include: [...CORE_OPTIMIZE_DEPS],
    entries: [resolve(__dirname, 'index.html'), ...prebundleEntries],
  },
  server: {
    port: 5173,
    strictPort: true,
    sourcemapIgnoreList: false,
    fs: {
      allow: [resolve(__dirname, '..'), UI_ROOT],
    },
    warmup: {
      clientFiles: [
        ...prebundleEntries,
        './src/modules/file-editor/views/FileWorkbenchView.vue',
      ],
    },
  },
  css: {
    devSourcemap: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 安装包内不带 .map，避免 F12 / 解包看到 Vue/TS 源码。
    sourcemap: false,
    // @vueuse/core 的 /* #__PURE__ */ 位置 Rolldown 不认；依赖产物，关掉以免污染 CI。
    rolldownOptions: {
      checks: {
        invalidAnnotation: false,
      },
    },
  },
  }
})
