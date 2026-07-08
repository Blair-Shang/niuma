import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
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
 */
const CORE_OPTIMIZE_DEPS = ['vue', 'vue-router', 'pinia', 'vue-i18n'] as const

const UI_SRC = resolve(__dirname, '../packages/ui/src')
const buildInfo = loadBuildInfo(__dirname)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../build'), 'VITE_')
  const version = env.VITE_NIUMA_VERSION || buildInfo.version
  const buildId = env.VITE_NIUMA_BUILD_ID || buildInfo.buildId

  return {
    plugins: [vue(), tailwindcss(), serveMonorepoPlugins(resolve(__dirname, '../plugins'))],
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
