import type { Component } from 'vue'

/**
 * 连接类型插槽定义 —— 描述某种协议需要向通用连接表单对话框（ConnectionFormDialog）
 * 注入哪些 UI 片段。每个字段均为可选；未填写的字段使用对话框的默认渲染。
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 字段速查                                                                │
 * ├─────────────────────┬───────────────────────────────────────────────────┤
 * │ credentialSection   │ 替换整个「用户名 + 密码」区。                     │
 * │                     │ props: { form: ConnectionFormState,               │
 * │                     │          mode: ConnectionDlgMode }                │
 * │                     │ 适合凭据结构特殊的协议（SSH 多认证方式等）。      │
 * │                     │ 不填 → 显示默认「用户名 + 密码」行。              │
 * ├─────────────────────┼───────────────────────────────────────────────────┤
 * │ credentialHint      │ 凭据区下方提示文字的 i18n key。                   │
 * │                     │ 仅对默认 credentialSection 有效；               │
 * │                     │ 自定义 credentialSection 由组件自行处理提示。     │
 * ├─────────────────────┼───────────────────────────────────────────────────┤
 * │ options             │ 协议专属选项区组件，追加在凭据区之后。            │
 * │                     │ props: { form: ConnectionFormState }              │
 * │                     │ 适合有额外配置的协议（FTP 编码/被动模式、        │
 * │                     │ Redis 拓扑/数据库/节点、MySQL 数据库名等）。      │
 * ├─────────────────────┼───────────────────────────────────────────────────┤
 * │ passwordOptional    │ true → 默认凭据区密码字段不标 required。          │
 * │                     │ 适合密码为可选的协议（Redis、某些 FTP 匿名站）。  │
 * │                     │ 使用自定义 credentialSection 时此字段无效。       │
 * ├─────────────────────┼───────────────────────────────────────────────────┤
 * │ supportsTunnel      │ true → 连接表单展示「隧道」Tab 并校验隧道字段。   │
 * │                     │ 仅 Redis v0.1 为 true；FTP/SSH 隧道尚未实现。     │
 * └─────────────────────┴───────────────────────────────────────────────────┘
 */
export interface ConnectionKindSlotDef {
  credentialSection?: Component
  credentialHint?: string
  options?: Component
  passwordOptional?: boolean
  supportsTunnel?: boolean
}

/**
 * 连接类型注册表（key = 协议标识符，与 ConnKind / API options.kind 保持一致）。
 *
 * 请勿直接写入此对象；使用 registerConnectionKind()。
 * 查询时使用 getConnectionKindDef()。
 *
 * 生命周期要求：
 *   所有 registerConnectionKind() 调用必须在使用此注册表的组件（OpsConnectionPanel
 *   等）挂载之前完成。项目中通过 main.ts 在挂载前调用
 *   registerBuiltinConnectionKinds() 来保证顺序（参见 modules/ops/connection-kinds.ts）。
 */
const _registry: Record<string, ConnectionKindSlotDef> = {}

/**
 * 向注册表中登记一种连接协议的 UI 插槽定义。
 *
 * 重复注册同一 kind 会覆盖之前的定义，可用于：
 *   - 插件协议动态替换内置渲染
 *   - 测试环境 mock
 *
 * @param kind  协议标识符（'ftp' / 'redis' / 'ssh' / 'mysql' 等）
 * @param def   该协议的插槽定义
 */
export function registerConnectionKind(kind: string, def: ConnectionKindSlotDef): void {
  _registry[kind] = def
}

/**
 * 查询指定协议的插槽定义。
 *
 * @returns 已注册的定义，或 undefined（未注册时对话框显示纯通用字段，无协议专属区）
 */
export function getConnectionKindDef(kind: string): ConnectionKindSlotDef | undefined {
  return _registry[kind]
}
