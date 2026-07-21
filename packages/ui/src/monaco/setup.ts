const hoverContainerPatchKey = '__rsHoverFixedContainerPatch'

type HoverShowOptions = { container?: HTMLElement }
type HoverServiceProto = {
  [hoverContainerPatchKey]?: boolean
  _showHover?(
    hover: unknown,
    options: HoverShowOptions | undefined,
    focus: boolean,
  ): unknown
}

type WorkerCtor = new () => Worker

/** 各 label 只动态 import 一次 Worker 构造器；实例按需 new。 */
const workerCtorCache = new Map<string, Promise<WorkerCtor>>()

function loadWorkerCtor(
  key: string,
  loader: () => Promise<{ default?: WorkerCtor } | WorkerCtor>,
): Promise<WorkerCtor> {
  let pending = workerCtorCache.get(key)
  if (!pending) {
    pending = loader().then((mod) => {
      const Ctor =
        typeof mod === 'function'
          ? mod
          : (mod as { default?: WorkerCtor }).default
      if (typeof Ctor !== 'function') {
        throw new Error(`[monaco] Worker constructor missing for "${key}"`)
      }
      return Ctor
    })
    workerCtorCache.set(key, pending)
  }
  return pending
}

/**
 * Find Widget 按钮的 hover tooltip 默认挂在编辑器容器内并以 absolute 定位。
 * 外层若有 overflow:hidden / 滚动容器，tooltip 会被裁剪或坐标偏移。
 * 改为挂到 document.body 并走 fixed 定位（Monaco ContextView 内置逻辑）。
 */
function patchMonacoHoverContainer(HoverService: {
  prototype: HoverServiceProto
}): void {
  const proto = HoverService.prototype
  if (proto[hoverContainerPatchKey] || !proto._showHover) return

  const original = proto._showHover
  proto._showHover = function (
    hover: unknown,
    options: HoverShowOptions | undefined,
    focus: boolean,
  ) {
    if (options) {
      options.container = document.body
    }
    return original.call(this, hover, options, focus)
  }
  proto[hoverContainerPatchKey] = true
}

async function ensureHoverPatch(): Promise<void> {
  // @ts-expect-error Monaco 内部 ESM 路径无类型声明
  const mod = await import('monaco-editor/esm/vs/platform/hover/browser/hoverService.js')
  patchMonacoHoverContainer(mod.HoverService)
}

/**
 * 配置 Monaco Editor Web Worker 环境（仅注册工厂，不预创建线程、不预拉 Worker 脚本）。
 *
 * 必须在任何 Monaco Editor 实例创建前调用一次（通常在应用入口 main.ts 顶部）。
 * getWorker 按 label 动态 import对应 ?worker，并返回 Promise&lt;Worker&gt;（Monaco 支持）。
 */
export function setupMonacoWorkers(): void {
  if (typeof window === 'undefined') return

  // Hover patch 延后加载 monaco 内部模块，避免入口同步吞下大量 editor 代码
  void ensureHoverPatch()

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Promise<Worker> {
      if (label === 'json') {
        return loadWorkerCtor('json', () =>
          import('monaco-editor/esm/vs/language/json/json.worker?worker'),
        ).then((Ctor) => new Ctor())
      }
      if (label === 'typescript' || label === 'javascript') {
        return loadWorkerCtor('typescript', () =>
          import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
        ).then((Ctor) => new Ctor())
      }
      // monaco-sql-languages：createWebWorker 的 label = languageId；仅打开对应方言编辑器时加载
      if (label === 'pgsql') {
        return loadWorkerCtor('pgsql', () =>
          import('monaco-sql-languages/esm/languages/pgsql/pgsql.worker?worker'),
        ).then((Ctor) => new Ctor())
      }
      return loadWorkerCtor('editor', () =>
        import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      ).then((Ctor) => new Ctor())
    },
  }
}
