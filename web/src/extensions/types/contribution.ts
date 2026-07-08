/** IDE 级贡献点 — P3 实现运行时注册 */

export interface CommandContribution {
  id: string
  title: string
  icon?: string
  keybinding?: string
}

export interface ViewContribution {
  id: string
  title: string
  /** module-sidebar | module-panel */
  location: string
}

export interface MenuContribution {
  id: string
  command: string
  group?: string
}

export interface ExtensionContributions {
  commands?: CommandContribution[]
  views?: ViewContribution[]
  menus?: MenuContribution[]
}
