/**
 * 环境配置工作台。对齐 http/tcp：目录自持，Shell 只拿 loader。
 * 新增同类配置页时在本目录加工作台，再在 shell/internal-views 登记一行。
 */
export const environmentView = {
  titleKey: 'modules.api.sideEnvironment',
  icon: 'globe',
  load: () => import('./EnvironmentWorkspace.vue'),
}
