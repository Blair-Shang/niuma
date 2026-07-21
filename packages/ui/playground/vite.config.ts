import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { monacoZhNlsPlugin } from '../vite-plugins/monaco-zh-nls'
import { silenceAntlrParseConsole } from '../vite-plugins/silence-antlr-parse-console'

const playgroundRoot = fileURLToPath(new URL('.', import.meta.url))
const faviconSvgPath = path.join(playgroundRoot, 'public', 'favicon.svg')

/** 浏览器默认请求 /favicon.ico，回退到 SVG 避免 404 噪音 */
function faviconIcoFallback(): Plugin {
  const serveSvgAsIco = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (req.url !== '/favicon.ico') {
      next()
      return
    }
    if (!fs.existsSync(faviconSvgPath)) {
      next()
      return
    }
    res.setHeader('Content-Type', 'image/svg+xml')
    fs.createReadStream(faviconSvgPath).pipe(res)
  }

  return {
    name: 'favicon-ico-fallback',
    configureServer(server) {
      server.middlewares.use(serveSvgAsIco)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveSvgAsIco)
    },
  }
}

export default defineConfig({
  root: playgroundRoot,
  publicDir: 'public',
  plugins: [
    vue(),
    tailwindcss(),
    faviconIcoFallback(),
    // Monaco 原生右键菜单中文化
    monacoZhNlsPlugin(),
    silenceAntlrParseConsole(),
  ],
  resolve: {
    alias: {
      '@ruoshui/ui': fileURLToPath(new URL('../src', import.meta.url)),
      '@niuma/ui': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})
