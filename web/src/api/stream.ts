import { bridgeInvoke } from '@/api/client'

export interface ShellStreamOpenParams {
  method: string
  id: string
  paramsJson: string
}

export interface ShellStreamCloseParams {
  id: string
}

/** Shell 原生 Platform stream 管道（`shell.stream.*`） */
export const shellStreamApi = {
  open(params: ShellStreamOpenParams) {
    return bridgeInvoke<{ opened: boolean }>('shell.stream.open', params)
  },

  close(params: ShellStreamCloseParams) {
    return bridgeInvoke<{ closed: boolean }>('shell.stream.close', params)
  },
}
