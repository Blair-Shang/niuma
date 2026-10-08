/**
 * 本机 Mock 工作台。Shell 只拿 loader。
 */
export const mockView = {
  titleKey: 'modules.api.sideMock',
  icon: 'server',
  load: () => import('./MockWorkspace.vue'),
}
