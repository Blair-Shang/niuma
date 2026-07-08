/**
 * 预热文件工作台路由 chunk 与 CodeMirror 核心。
 *
 * 辅助 CEF 窗口为独立 Browser，首开会重新执行 main.ts 并拉取懒加载模块；
 * 主窗口闲时预热可使 dev HTTP 缓存 / 磁盘缓存命中，缩短首次开窗的网络等待。
 */
export async function prewarmFileWorkbenchChunks(): Promise<void> {
  const { prewarmCodeEditor } = await import('@/modules/file-editor/utils/prewarm-editor')
  await Promise.all([
    import('@/modules/file-editor/views/FileWorkbenchView.vue'),
    prewarmCodeEditor('plaintext').catch(() => {}),
  ])
}
