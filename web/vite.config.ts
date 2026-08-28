import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { monacoZhNlsPlugin } from '@niuma/ui/vite-plugins/monaco-zh-nls'
import { silenceAntlrParseConsole } from '@niuma/ui/vite-plugins/silence-antlr-parse-console'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { serveMonorepoPlugins } from './vite-plugins/serve-monorepo-plugins'

/**
 * 仅包含 @niuma/web 可直接 resolve 的依赖。
 * CodeMirror / xterm 由 @niuma/ui 的 vite-*-deps.ts 作为 optimize 入口预构建
 *（它们装在 niuma-ui 下，web 无法直接 resolve，不能写进 include）。
 * Monaco 不放进 include：整包预构建过重，且会拖慢 / 卡住 dev server 启动；
 * Schema 面板已对 Validator（RsMonacoEditor）做按需异步加载，避免首开 Tab 触发重优化。
 */
const CORE_OPTIMIZE_DEPS = ['vue', 'vue-router', 'pinia', 'vue-i18n', 'echarts', 'vue-echarts'] as const

const require = createRequire(import.meta.url)
const UI_ROOT = dirname(require.resolve('@niuma/ui/package.json'))
const UI_SRC = resolve(UI_ROOT, 'src')

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    serveMonorepoPlugins(resolve(__dirname, '../plugins')),
    monacoZhNlsPlugin(),
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
    entries: [
      resolve(__dirname, 'index.html'),
      resolve(UI_SRC, 'dev/vite-codemirror-deps.ts'),
      resolve(UI_SRC, 'dev/vite-xterm-deps.ts'),
      resolve(UI_SRC, 'components/RsCodeEditor.vue'),
    ],
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
        resolve(UI_SRC, 'dev/vite-codemirror-deps.ts'),
        resolve(UI_SRC, 'dev/vite-xterm-deps.ts'),
        resolve(UI_SRC, 'components/RsCodeEditor.vue'),
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
    sourcemap: true,
    // @vueuse/core 的 /* #__PURE__ */ 位置 Rolldown 不认；依赖产物，关掉以免污染 CI。
    rolldownOptions: {
      checks: {
        invalidAnnotation: false,
      },
    },
  },
})
