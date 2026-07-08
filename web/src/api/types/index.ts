export type { PingResult, ShellInfo, ShellVersion } from './shell'
export type { DialogOpenFolderParams, DialogOpenFolderResult } from './dialog'
export type {
  SettingGetParams,
  SettingGetResult,
  SettingSetParams,
  SettingSetResult,
} from './settings'
export type {
  PluginListResult,
  PluginRecord,
  SetPluginEnabledParams,
  SetPluginEnabledResult,
} from './plugin'
export type {
  WindowActionResult,
  WindowFullscreenParams,
  WindowIdParams,
  WindowListResult,
  WindowOpenParams,
  WindowOpenResult,
  WindowState,
  WindowSummary,
} from './window'
export type {
  ConnectionCreateParams,
  ConnectionCreateResult,
  ConnectionDeleteParams,
  ConnectionDeleteResult,
  ConnectionGetParams,
  ConnectionGetResult,
  ConnectionListParams,
  ConnectionListResult,
  ConnectionOptionsBase,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionUpdateParams,
  ConnectionUpdateResult,
  CredentialDeleteParams,
  CredentialDeleteResult,
  CredentialInput,
  CredentialSetParams,
  CredentialSetResult,
  ProxyOptions,
  ProxyType,
} from './connection'
export { DEFAULT_PROXY_OPTIONS, defaultProxyPort } from './connection'
export { DEFAULT_FTP_OPTIONS } from './ftp'
export type {
  FtpConnectionOptions,
  FtpDirListParams,
  FtpDirListResult,
  FtpDirMakeParams,
  FtpDirMakeResult,
  FtpEntry,
  FtpSessionCloseParams,
  FtpSessionOpenParams,
  FtpSessionOpenResult,
  FtpSessionTestParams,
  FtpSessionTestResult,
} from './ftp'
export { DEFAULT_SSH_OPTIONS } from './ssh'
export type {
  SshConnectionOptions,
  SshExecRunParams,
  SshExecRunResult,
  SshTerminalCloseParams,
  SshTerminalDataEvent,
  SshTerminalExitEvent,
  SshTerminalInputParams,
  SshTerminalOpenParams,
  SshTerminalOpenResult,
  SshTerminalResizeParams,
  SshTerminalState,
  SshTerminalStateEvent,
  SshSessionCloseParams,
  SshSessionOpenParams,
  SshSessionOpenResult,
  SshSessionTestParams,
  SshSessionTestResult,
  SshSftpDirListParams,
  SshSftpDirListResult,
  SshSftpEntry,
  SshSftpFileReadParams,
  SshSftpFileReadResult,
  SshSftpFileWriteParams,
  SshSftpFileWriteResult,
} from './ssh'
