/** Runner 模式注册表（P1 空壳，见 docs/38-api-run.md）。 */

export type ApiRunMode = 'single' | 'collection' | 'load'

export interface ApiRunModeDef {
  mode: ApiRunMode
  labelKey: string
  allowsConcurrency: boolean
}

const MODES: readonly ApiRunModeDef[] = [
  { mode: 'single', labelKey: 'modules.api.runSingle', allowsConcurrency: false },
]

/** 当前已注册的 Runner 模式。 */
export function listRunModes(): readonly ApiRunModeDef[] {
  return MODES
}
