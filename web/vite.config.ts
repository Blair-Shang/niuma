import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { monacoZhNlsPlugin } from '../packages/ui/vite-plugins/monaco-zh-nls'
import { silenceAntlrParseConsole } from '../packages/ui/vite-plugins/silence-antlr-parse-console'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveMonorepoPlugins } from './vite-plugins/serve-monorepo-plugins'

function loadBuildInfo(rootDir: string) {
  const manifest = resolve(rootDir, '../build/version.json')
  if (existsSync(manifest)) {
    return JSON.parse(readFileSync(manifest, 'utf8')) as {
      version: string
      buildId: string
      buildDate: string
    }
  }
  const rootPkg = JSON.parse(readFileSync(resolve(rootDir, '../package.json'), 'utf8'))
  return { version: rootPkg.version ?? 'dev', buildId: 'dev', buildDate: '' }
}

/**
 * 仅包含 @niuma/web 可直接 resolve 的依赖。
 * CodeMirror 语言包由 packages/ui/src/dev/vite-codemirror-deps.ts 作为 optimize 入口预构建。
 * Monaco 不放进 include：整包预构建过重，且会拖慢 / 卡住 dev server 启动；
 * Schema 面板已对 Validator（RsMonacoEditor）做按需异步加载，避免首开 Tab 触发重优化。
 */
const CORE_OPTIMIZE_DEPS = ['vue', 'vue-router', 'pinia', 'vue-i18n', 'echarts', 'vue-echarts'] as const

const UI_SRC = resolve(__dirname, '../packages/ui/src')
const buildInfo = loadBuildInfo(__dirname)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../build'), 'VITE_')
  const version = env.VITE_NIUMA_VERSION || buildInfo.version
  const buildId = env.VITE_NIUMA_BUILD_ID || buildInfo.buildId

  return {
    plugins: [
      vue(),
      tailwindcss(),
      serveMonorepoPlugins(resolve(__dirname, '../plugins')),
      // 注入 Monaco 官方中文 NLS，右键菜单/命令面板等 UI 显示中文
      monacoZhNlsPlugin(),
      // SQL 补全半成品 parse 不再刷 antlr console.error
      silenceAntlrParseConsole(),
    ],
    base: './',
    define: {
      __NIUMA_VERSION__: JSON.stringify(version),
      __NIUMA_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    optimizeDeps: {
      include: [...CORE_OPTIMIZE_DEPS],
      entries: [
        resolve(__dirname, 'index.html'),
        resolve(UI_SRC, 'dev/vite-codemirror-deps.ts'),
        resolve(UI_SRC, 'components/RsCodeEditor.vue'),
      ],
    },
    server: {
      port: 5173,
      strictPort: true,
      sourcemapIgnoreList: false,
      warmup: {
        clientFiles: [
          resolve(UI_SRC, 'dev/vite-codemirror-deps.ts'),
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
    },
  }
})
