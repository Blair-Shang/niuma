export { setupMonacoWorkers } from './setup'
export { patchMonacoCreateWebWorkerCompat } from './create-web-worker-compat'
export type {
  MonacoBuiltinLanguage,
  MonacoLanguage,
  MonacoSqlLanguageId,
} from './languages'
export {
  ensureMongodbShellLanguage,
  MONACO_MONGODB_SHELL_LANGUAGE,
  MONACO_PGSQL_LANGUAGE,
} from './languages'
export {
  applyMonacoDebugDecorations,
  buildMonacoDebugDecorations,
  RS_MONACO_DEBUG,
} from './debug-decorations'
export type { MonacoDebugDecorationState } from './debug-decorations'
