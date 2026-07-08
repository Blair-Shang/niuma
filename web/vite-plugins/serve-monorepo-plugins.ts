import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * 开发模式下将 monorepo `plugins/` 目录映射到 `/plugins/*`。
 * 与 CEF `app://niuma/plugins/` 路径对齐，供 dev:web 调试。
 *
 * @param pluginsRoot - 仓库根下 plugins 绝对路径
 */
export function serveMonorepoPlugins(pluginsRoot: string): Plugin {
  const root = path.normalize(pluginsRoot)

  return {
    name: 'niuma-serve-plugins',
    configureServer(server) {
      server.middlewares.use('/plugins', (req, res, next) => {
        if (!req.url) {
          next()
          return
        }

        const rel = decodeURIComponent(req.url.split('?')[0] ?? '')
        const filePath = path.normalize(path.join(root, rel))
        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.statusCode = 404
          res.end('Not Found')
          return
        }

        const ext = path.extname(filePath)
        const mime =
          ext === '.js' || ext === '.mjs'
            ? 'text/javascript'
            : ext === '.json'
              ? 'application/json'
              : 'application/octet-stream'
        res.setHeader('Content-Type', mime)
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}
