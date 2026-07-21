/**
 * Vastbase / PostgreSQL：按需接入 monaco-sql-languages（内置 dt-sql-parser）。
 * 首次打开查询编辑器时再拉 contribution / 语言服务；格式化 Provider 内再拉 sql-formatter。
 *
 * 对象补全基调（schema/表/列）：见 docs/23-sql-dialect-completion.md
 * （DBeaver/Navicat：客户端槽位 + catalog.* + 会话缓存；勿用 tree 全量预拉）。
 * completionService 由调用方注入，合并 catalog 候选与 defaultCompletionService。
 *
 * Worker 走 MonacoEnvironment 官方 pgsql.worker（packages/ui setupMonacoWorkers），不自定义包装。
 */
import { patchMonacoCreateWebWorkerCompat } from '@niuma/ui'
import type { CompletionService } from 'monaco-sql-languages'

/** 与 LanguageIdEnum.PG 一致；勿静态 import monaco-sql-languages，以免入口抢跑。 */
export const VASTBASE_MONACO_LANGUAGE_ID = 'pgsql' as const

let readyPromise: Promise<string> | null = null

/**
 * 幂等：动态加载 pgsql 贡献、语言特性与格式化 Provider。
 * 返回 languageId，可直接用作 RsMonacoEditor language。
 */
export function ensureVastbasePgsqlLanguage(
  completionService?: CompletionService,
): Promise<string> {
  if (!readyPromise) {
    readyPromise = loadAndRegister(completionService).catch((err) => {
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

async function loadAndRegister(
  completionService?: CompletionService,
): Promise<string> {
  // monaco-editor 无 default；主入口才导出顶层 createWebWorker（0.55 兼容所需）
  const [monaco, sqlLang] = await Promise.all([
    import('monaco-editor'),
    import('monaco-sql-languages'),
    import('monaco-sql-languages/esm/languages/pgsql/pgsql.contribution'),
  ])

  // 必须在 setupLanguageFeatures 之前：否则会走 undefined worker → Missing doValidation
  patchMonacoCreateWebWorkerCompat(monaco)

  const {
    defaultCompletionService,
    LanguageIdEnum,
    setupLanguageFeatures,
  } = sqlLang
  const languageId = LanguageIdEnum.PG

  const service: CompletionService =
    completionService ??
    (async (model, position, context, suggestions, entities, snippets) => {
      const base = await defaultCompletionService(
        model,
        position,
        context,
        suggestions,
        entities,
        snippets,
      )
      // 默认仅关键字/snippets；对象候选由 docs/23 catalog 编排注入 completionService
      return Array.isArray(base) ? base : base.suggestions
    })

  // 开启 diagnostics：语法错误显示红色波浪线（dt-sql-parser → Monaco markers）。
  // 补全仍会 parse 半成品 SQL；antlr ConsoleErrorListener 刷屏由 vite 插件静默。
  setupLanguageFeatures(languageId, {
    diagnostics: true,
    completionItems: {
      enable: true,
      triggerCharacters: [' ', '.', '"'],
      completionService: service,
    },
    definitions: false,
    references: false,
    hover: true,
  })

  // SQL 标识符含 `_`（docs/23）：保证 getWordUntilPosition 得到完整 prefix
  const { SQL_IDENT_WORD_PATTERN } = await import('@/modules/sql-editor/completion/prefix')
  monaco.languages.setLanguageConfiguration(languageId, {
    wordPattern: SQL_IDENT_WORD_PATTERN,
  })

  async function formatText(text: string): Promise<string> {
    const { formatSql } = await import('@/modules/sql-editor/format')
    return formatSql(text, { dialect: 'vastbase' })
  }

  monaco.languages.registerDocumentFormattingEditProvider(languageId, {
    async provideDocumentFormattingEdits(model) {
      return [
        {
          range: model.getFullModelRange(),
          text: await formatText(model.getValue()),
        },
      ]
    },
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
    async provideDocumentRangeFormattingEdits(model, range) {
      return [
        {
          range,
          text: await formatText(model.getValueInRange(range)),
        },
      ]
    },
  })

  return languageId
}
