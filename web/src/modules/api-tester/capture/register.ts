/**
 * 本机抓包页。代理只听 127.0.0.1。
 */
export const captureView = {
  titleKey: 'modules.api.sideCapture',
  icon: 'radar',
  load: () => import('./CaptureWorkspace.vue'),
}
