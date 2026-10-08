/**
 * 集合运行工作台。Shell 只拿 loader。
 */
export const runView = {
  titleKey: 'modules.api.sideRunner',
  icon: 'list-checks',
  load: () => import('./RunWorkspace.vue'),
}
