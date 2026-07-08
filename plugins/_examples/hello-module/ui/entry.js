/**
 * Hello 插件 ESM 入口（P1–P3）。
 * 由 app://niuma/plugins/ 或 Vite /plugins 提供，不含 Vue 编译依赖。
 */

/** @type {import('@/extensions/api/create-extension-context').ExtensionActivateContext} */
export async function activate(context) {
  context.commands.register('hello.run', () => {
    globalThis.alert?.('Hello from Command Palette (hello.run)')
  })

  context.subscriptions.push({
    dispose() {
      // 占位清理逻辑
    },
  })
}

export const pluginMeta = {
  title: 'Hello Module',
  description: 'P1 example extension loaded from plugins/_examples/hello-module',
}
