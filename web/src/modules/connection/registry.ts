import type { Component } from 'vue'

/**
 * 连接类型插槽定义 —— 描述某种协议需要向通用连接表单对话框（ConnectionFormDialog）
 * 注入哪些 UI 片段。每个字段均为可选；未填写的字段使用对话框的默认渲染。
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 字段速查                                                                │
 * ├─────────────────────┬───────────────────────────────────────────────────┤
 * │ credentialSection   │ 替换整个「用户名 + 密码」区。                     │
 * │ credentialHint      │ 凭据区下方提示文字的 i18n key。                   │
 * │ options             │ 协议专属选项（追加在「基础信息」凭据区之后）。    │
 * │ ssl                 │ 独立「SSL」Tab 内容（对齐 Navicat / DBeaver）。   │
 * │ advanced            │ 独立「高级」Tab 内容（编码、超时等）。            │
 * │ passwordOptional    │ true → 默认凭据区密码字段不标 required。          │
 * │ supportsTunnel      │ true → 连接表单展示「隧道」Tab。                  │
 * └─────────────────────┴───────────────────────────────────────────────────┘
 */
export interface ConnectionKindSlotDef {
  credentialSection?: Component
  credentialHint?: string
  options?: Component
  /** SSL / TLS 独立 Tab（props: { form }） */
  ssl?: Component
  /** 高级选项独立 Tab（props: { form }） */
  advanced?: Component
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
 *   等）挂载之前完成——或在首次使用前经由 ensureConnKind() 完成。
 *   项目中通过 main.ts 调用 registerBuiltinConnKindLoaders() 登记懒加载入口。
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
