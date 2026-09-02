/**
 * AI Context Pack：从当前工作区采集可 @ 引用的上下文（对齐 Cursor @）。
 */
import { useTabStore, type WorkspaceTab } from '@/stores/tab'
import { useSessionRegistry } from '@/stores/session-registry'
import {
  buildAiDialectRules,
  defaultProfileForFamily,
} from '@/modules/sql-editor/capabilities'
import type { ConnKind } from '@/modules/ops/types'
import {
  getEditorSelection,
  listDiagnostics,
} from './workspace-context'

/** 有 SQL 方言默认 Profile 的模块（无 lease 时回退用） */
const SQL_DIALECT_MODULES = new Set<string>([
  'vastbase',
  'mysql',
  'sqlite',
  'dameng',
  'oracle',
  'clickhouse',
  'kingbase',
  'sqlserver',
  'postgres',
])

export type AiContextKind = 'tab' | 'selection' | 'connection' | 'diagnostic' | 'schema'

export interface AiContextAttachment {
  id: string
  kind: AiContextKind
  label: string
  detail?: string
  payload: Record<string, unknown>
}

export interface AiContextPack {
  workspace: {
    tabId?: string
    moduleId?: string
    profileId?: string
    sessionId?: string
    title?: string
    database?: string
    schema?: string
    cwd?: string
    dialectFamily?: string
    capabilities?: string[]
    dialectRules?: string
  }
  attachments: AiContextAttachment[]
  /** 本地预览用摘要（入模以后端 Normalize 为准）。 */
  promptAppendix: string
}

function tabLabel(tab: WorkspaceTab): string {
  return tab.title?.trim() || tab.titleKey || tab.moduleId || tab.tabId
}

/** 从工作区页签构造 @ 引用（拖入 AI / @ 列表共用）。 */
export function attachmentFromTab(tab: WorkspaceTab): AiContextAttachment {
  const sessionRegistry = useSessionRegistry()
  const profileId = typeof tab.props.profileId === 'string' ? tab.props.profileId : undefined
  const sessionId = sessionRegistry.getSessionIdForTab(tab.tabId) ?? undefined
  const cwd = typeof tab.props.remotePath === 'string' ? tab.props.remotePath.trim() : ''
  return {
    id: `tab:${tab.tabId}`,
    kind: 'tab',
    label: tabLabel(tab),
    detail: [tab.moduleId, profileId].filter(Boolean).join(' · '),
    payload: {
      tabId: tab.tabId,
      moduleId: tab.moduleId,
      profileId,
      sessionId,
      database: tab.props.database,
      schema: tab.props.schema,
      path: tab.moduleId === 'ssh' && cwd ? cwd : undefined,
    },
  }
}

function readDomSelectionSnippet(): string {
  try {
    const sel = window.getSelection()?.toString()?.trim()
    if (sel && sel.length > 0 && sel.length <= 8000) {
      return sel
    }
  } catch {
    // ignore
  }
  return ''
}

/** 优先 Monaco 注册表选区，其次 DOM Selection。 */
export function readSelectionSnippet(): string {
  const fromEditor = getEditorSelection()?.text?.trim()
  if (fromEditor) {
    return fromEditor.slice(0, 8000)
  }
  return readDomSelectionSnippet()
}

/** 从当前选区构造 attachment（供 askSelection / @）。 */
export function selectionAttachmentFromWorkspace(): AiContextAttachment | null {
  const selection = readSelectionSnippet()
  if (!selection) {
    return null
  }
  const snap = getEditorSelection()
  const source = snap?.source
  const language = snap?.language
  const detailParts = [`${selection.length} chars`]
  if (source === 'terminal') detailParts.push('terminal')
  if (language) detailParts.push(language)
  return {
    id: `sel:${hashId(selection)}`,
    kind: 'selection',
    label:
      source === 'terminal'
        ? selection.length > 40
          ? `终端选区：${selection.slice(0, 40)}…`
          : `终端选区：${selection}`
        : selection.length > 48
          ? `${selection.slice(0, 48)}…`
          : selection,
    detail: detailParts.join(' · '),
    payload: {
      text: selection.slice(0, 4000),
      language: language || (source === 'terminal' ? 'text' : undefined),
      source,
      tabId: snap?.tabId,
    },
  }
}

function schemaHintFromTab(tab: WorkspaceTab | null | undefined): AiContextAttachment | null {
  if (!tab) {
    return null
  }
  const database = typeof tab.props.database === 'string' ? tab.props.database : undefined
  const schema = typeof tab.props.schema === 'string' ? tab.props.schema : undefined
  const table =
    typeof tab.props.table === 'string'
      ? tab.props.table
      : typeof tab.props.objectName === 'string'
        ? tab.props.objectName
        : undefined
  const parts = [database, schema, table].filter(Boolean) as string[]
  if (!parts.length) {
    return null
  }
  const label = parts.join('.')
  return {
    id: `schema:${tab.tabId}:${label}`,
    kind: 'schema',
    label,
    detail: 'schema',
    payload: {
      tabId: tab.tabId,
      moduleId: tab.moduleId,
      profileId: tab.props.profileId,
      database,
      schema,
      table,
    },
  }
}

/** 列出可供 @ 选择的候选项（当前 Tab、打开的 Tabs、选区、诊断、schema）。 */
export function listMentionCandidates(): AiContextAttachment[] {
  const tabStore = useTabStore()
  const out: AiContextAttachment[] = []
  const active = tabStore.activeTab
  if (active) {
    const profileId = typeof active.props.profileId === 'string' ? active.props.profileId : undefined
    out.push(attachmentFromTab(active))
    if (profileId) {
      out.push({
        id: `conn:${profileId}`,
        kind: 'connection',
        label: String(active.title || profileId),
        detail: 'connection',
        payload: { profileId, moduleId: active.moduleId },
      })
    }
    const schemaHint = schemaHintFromTab(active)
    if (schemaHint) {
      out.push(schemaHint)
    }
    const remotePath =
      typeof active.props.remotePath === 'string' ? active.props.remotePath.trim() : ''
    if (active.moduleId === 'ssh' && remotePath) {
      out.push({
        id: `cwd:${active.tabId}:${remotePath}`,
        kind: 'tab',
        label: remotePath,
        detail: 'sftp',
        payload: {
          tabId: active.tabId,
          moduleId: 'ssh',
          path: remotePath,
        },
      })
    }
  }
  for (const tab of tabStore.allTabs) {
    if (active && tab.tabId === active.tabId) {
      continue
    }
    out.push(attachmentFromTab(tab))
  }
  const selection = selectionAttachmentFromWorkspace()
  if (selection) {
    out.push(selection)
  }
  for (const d of listDiagnostics()) {
    out.push({
      id: d.id,
      kind: 'diagnostic',
      label: d.label,
      detail: d.detail || d.kind || 'diagnostic',
      payload: {
        text: d.text,
        tabId: d.tabId,
        kind: d.kind,
      },
    })
  }
  return out
}

function hashId(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

/** 组装发送用 Context Pack（草稿；入模前由 Orchestrator Normalize）。 */
export function buildContextPack(attachments: AiContextAttachment[]): AiContextPack {
  const tabStore = useTabStore()
  const sessionRegistry = useSessionRegistry()
  const active = tabStore.activeTab
  const sessionId = active ? sessionRegistry.getSessionIdForTab(active.tabId) ?? undefined : undefined
  // 优先会话探测结果；无 lease 时按当前模块方言回退（非永久禁令）
  const moduleKind = (active?.moduleId && SQL_DIALECT_MODULES.has(active.moduleId)
    ? active.moduleId
    : undefined) as ConnKind | undefined
  const dialect =
    (sessionId ? sessionRegistry.getDialectForSession(sessionId) : null) ??
    (typeof active?.props.profileId === 'string'
      ? sessionRegistry.getDialectForProfile(active.props.profileId, moduleKind)
      : null) ??
    (moduleKind ? defaultProfileForFamily(moduleKind) : null)
  const workspace = {
    tabId: active?.tabId,
    moduleId: active?.moduleId,
    profileId: typeof active?.props.profileId === 'string' ? active.props.profileId : undefined,
    sessionId,
    title: active ? tabLabel(active) : undefined,
    database: typeof active?.props.database === 'string' ? active.props.database : undefined,
    schema: typeof active?.props.schema === 'string' ? active.props.schema : undefined,
    cwd: typeof active?.props.remotePath === 'string' ? active.props.remotePath : undefined,
    dialectFamily: dialect?.family,
    capabilities: dialect?.capabilities,
    dialectRules: dialect ? buildAiDialectRules(dialect) : undefined,
  }

  const lines: string[] = []
  if (workspace.moduleId || workspace.profileId || workspace.sessionId) {
    lines.push(
      `[workspace] module=${workspace.moduleId ?? '-'} profile=${workspace.profileId ?? '-'} session=${workspace.sessionId ?? '-'} db=${workspace.database ?? '-'} schema=${workspace.schema ?? '-'} cwd=${workspace.cwd ?? '-'} tab=${workspace.title ?? '-'}`,
    )
  }
  for (const a of attachments) {
    if (a.kind === 'selection' && typeof a.payload.text === 'string') {
      const lang =
        typeof a.payload.language === 'string' && a.payload.language.trim()
          ? a.payload.language.trim()
          : ''
      const src =
        typeof a.payload.source === 'string' && a.payload.source.trim()
          ? ` source=${a.payload.source.trim()}`
          : ''
      const fence = lang && lang !== 'text' ? lang : ''
      lines.push(
        `[selection${src}${lang ? ` language=${lang}` : ''}] ${a.label}\n\`\`\`${fence}\n${a.payload.text}\n\`\`\``,
      )
      continue
    }
    if (a.kind === 'diagnostic' && typeof a.payload.text === 'string') {
      lines.push(`[diagnostic] ${a.label}\n\`\`\`\n${a.payload.text}\n\`\`\``)
      continue
    }
    if (a.kind === 'schema') {
      const db = typeof a.payload.database === 'string' ? a.payload.database : '-'
      const sch = typeof a.payload.schema === 'string' ? a.payload.schema : '-'
      const tbl = typeof a.payload.table === 'string' ? a.payload.table : '-'
      lines.push(`[schema_hint] ${a.label} db=${db} schema=${sch} table=${tbl}`)
      continue
    }
    lines.push(`[${a.kind}] ${a.label}${a.detail ? ` (${a.detail})` : ''}`)
  }

  return {
    workspace,
    attachments,
    promptAppendix: lines.length ? `\n\n---\nContext:\n${lines.join('\n')}` : '',
  }
}

/** 用户可见消息中嵌入的引用标记（渲染为 chip）。 */
export function encodeAttachmentMarkers(attachments: AiContextAttachment[]): string {
  if (!attachments.length) {
    return ''
  }
  return (
    attachments
      .map((a) => {
        const payload = encodeURIComponent(JSON.stringify({ kind: a.kind, label: a.label, id: a.id }))
        return `⟦nm-ref:${payload}⟧`
      })
      .join(' ') + '\n\n'
  )
}

export function extractAttachmentMarkers(source: string): {
  text: string
  attachments: AiContextAttachment[]
} {
  const attachments: AiContextAttachment[] = []
  const text = source.replace(/⟦nm-ref:([^⟧]+)⟧/g, (_m, enc: string) => {
    try {
      const raw = JSON.parse(decodeURIComponent(enc)) as {
        kind?: AiContextKind
        label?: string
        id?: string
      }
      if (raw.label && raw.id) {
        attachments.push({
          id: raw.id,
          kind: raw.kind || 'tab',
          label: raw.label,
          payload: {},
        })
      }
    } catch {
      // ignore
    }
    return ''
  })
  return { text: text.replace(/^\s+/, ''), attachments }
}
