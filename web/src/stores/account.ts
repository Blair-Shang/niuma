import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  fetchMe,
  loginOtpComplete,
  loginOtpStart,
  loginPassword,
  logout as apiLogout,
  passwordChange,
  passwordForgot,
  passwordReset,
  patchMe,
  refreshAccess,
  registerComplete,
  registerStart,
  type AuthSession,
  type CloudUser,
} from '@/api/cloud/auth'
import {
  listMyFeedback,
  submitFeedback,
  type FeedbackInput,
  type FeedbackItem,
} from '@/api/cloud/feedback'

export type AuthMode = 'login' | 'register' | 'otp' | 'reset'

/** 与云端 validPassword 一致：8–128 字符 */
export const PASSWORD_MIN_LEN = 8
export const PASSWORD_MAX_LEN = 128
export const OTP_RESEND_COOLDOWN_SEC = 60

const STORAGE_KEY = 'nm.cloud.session'

type PersistedSession = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  user: CloudUser
}

function loadPersisted(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedSession
  } catch {
    return null
  }
}

function persist(session: PersistedSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export const useAccountStore = defineStore('account', () => {
  const user = ref<CloudUser | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const expiresAt = ref<string | null>(null)
  const bootstrapped = ref(false)

  const authOpen = ref(false)
  const authMode = ref<AuthMode>('login')
  const feedbackOpen = ref(false)
  const passwordChangeOpen = ref(false)

  const isLoggedIn = computed(() => !!user.value && !!accessToken.value)

  function applySession(session: AuthSession | PersistedSession): void {
    user.value = session.user
    accessToken.value = session.accessToken
    refreshToken.value = session.refreshToken
    expiresAt.value = session.expiresAt
    persist({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: session.user,
    })
  }

  async function bootstrap(): Promise<void> {
    if (bootstrapped.value) return
    bootstrapped.value = true
    const saved = loadPersisted()
    if (!saved) return
    accessToken.value = saved.accessToken
    refreshToken.value = saved.refreshToken
    expiresAt.value = saved.expiresAt
    user.value = saved.user
    try {
      await ensureAccess()
      user.value = await fetchMe(accessToken.value!)
      persist({
        accessToken: accessToken.value!,
        refreshToken: refreshToken.value!,
        expiresAt: expiresAt.value!,
        user: user.value,
      })
      void syncSystemAi()
    } catch {
      clearSession()
    }
  }

  function clearSession(): void {
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    expiresAt.value = null
    persist(null)
  }

  async function ensureAccess(): Promise<string> {
    if (!accessToken.value || !refreshToken.value) {
      throw new Error('not_logged_in')
    }
    const exp = expiresAt.value ? Date.parse(expiresAt.value) : 0
    if (exp - Date.now() > 60_000) {
      return accessToken.value
    }
    const next = await refreshAccess(refreshToken.value)
    accessToken.value = next.accessToken
    expiresAt.value = next.expiresAt
    user.value = next.user
    persist({
      accessToken: next.accessToken,
      refreshToken: refreshToken.value,
      expiresAt: next.expiresAt,
      user: next.user,
    })
    return next.accessToken
  }

  const pendingFeedback = ref(false)

  function openAuth(mode: AuthMode = 'login'): void {
    authMode.value = mode
    authOpen.value = true
  }

  function closeAuth(): void {
    authOpen.value = false
    // 取消「登录后继续反馈」意图，避免下次登录误开反馈窗
    if (!isLoggedIn.value) {
      pendingFeedback.value = false
    }
  }

  function openFeedback(): void {
    if (!isLoggedIn.value) {
      pendingFeedback.value = true
      openAuth('login')
      return
    }
    feedbackOpen.value = true
  }

  function closeFeedback(): void {
    feedbackOpen.value = false
  }

  function openPasswordChange(): void {
    if (!isLoggedIn.value) {
      openAuth('login')
      return
    }
    passwordChangeOpen.value = true
  }

  function closePasswordChange(): void {
    passwordChangeOpen.value = false
  }

  function finishAuthSuccess(): void {
    authOpen.value = false
    if (pendingFeedback.value) {
      pendingFeedback.value = false
      feedbackOpen.value = true
    }
    void syncSystemAi()
  }

  async function syncSystemAi(): Promise<void> {
    try {
      const token = await ensureAccess()
      const { ensureSystemAiProvider } = await import('@/shell/panels/ai/system-provider')
      await ensureSystemAiProvider(token)
      const { useAiStore } = await import('@/stores/ai')
      await useAiStore().refreshProviders()
    } catch {
      // 未登录、离线或云端未开通系统 AI 时忽略
    }
  }

  async function doLoginPassword(email: string, password: string): Promise<void> {
    applySession(await loginPassword(email, password))
    finishAuthSuccess()
  }

  async function doRegisterStart(email: string): Promise<void> {
    await registerStart(email)
  }

  async function doRegisterComplete(input: {
    email: string
    code: string
    password: string
    displayName?: string
  }): Promise<void> {
    applySession(await registerComplete(input))
    finishAuthSuccess()
  }

  async function doLoginOtpStart(email: string): Promise<void> {
    await loginOtpStart(email)
  }

  async function doLoginOtpComplete(email: string, code: string): Promise<void> {
    applySession(await loginOtpComplete(email, code))
    finishAuthSuccess()
  }

  async function doPasswordForgot(email: string): Promise<void> {
    await passwordForgot(email)
  }

  async function doPasswordReset(email: string, code: string, password: string): Promise<void> {
    await passwordReset(email, code, password)
    authMode.value = 'login'
  }

  async function doPasswordChange(currentPassword: string, newPassword: string): Promise<void> {
    const token = await ensureAccess()
    await passwordChange(token, currentPassword, newPassword)
  }

  async function updateDisplayName(displayName: string): Promise<void> {
    const token = await ensureAccess()
    const next = await patchMe(token, displayName)
    user.value = next
    if (accessToken.value && refreshToken.value && expiresAt.value) {
      persist({
        accessToken: accessToken.value,
        refreshToken: refreshToken.value,
        expiresAt: expiresAt.value,
        user: next,
      })
    }
  }

  async function doLogout(): Promise<void> {
    const rt = refreshToken.value
    pendingFeedback.value = false
    feedbackOpen.value = false
    passwordChangeOpen.value = false
    clearSession()
    if (rt) {
      try {
        await apiLogout(rt)
      } catch {
        /* ignore */
      }
    }
  }

  async function sendFeedback(input: FeedbackInput): Promise<void> {
    const token = await ensureAccess()
    await submitFeedback(input, token)
  }

  async function fetchMyFeedback(): Promise<FeedbackItem[]> {
    const token = await ensureAccess()
    return listMyFeedback(token)
  }

  return {
    user,
    accessToken,
    isLoggedIn,
    bootstrapped,
    authOpen,
    authMode,
    feedbackOpen,
    passwordChangeOpen,
    bootstrap,
    openAuth,
    closeAuth,
    openFeedback,
    closeFeedback,
    openPasswordChange,
    closePasswordChange,
    doLoginPassword,
    doRegisterStart,
    doRegisterComplete,
    doLoginOtpStart,
    doLoginOtpComplete,
    doPasswordForgot,
    doPasswordReset,
    doPasswordChange,
    updateDisplayName,
    doLogout,
    sendFeedback,
    fetchMyFeedback,
    ensureAccess,
  }
})
