<script setup lang="ts">
import { RsButton, RsDialog, RsInput } from '@niuma/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  OTP_RESEND_COOLDOWN_SEC,
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  useAccountStore,
  type AuthMode,
} from '@/stores/account'
import { CloudApiError } from '@/api/cloud/client'
import FeedbackHost from './FeedbackHost.vue'

const { t, te } = useI18n()
const account = useAccountStore()

const email = ref('')
const password = ref('')
const code = ref('')
const displayName = ref('')
const busy = ref(false)
const error = ref('')
const info = ref('')
const otpSent = ref(false)
const otpCooldown = ref(0)
let otpTimer: ReturnType<typeof setInterval> | null = null

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const pwdBusy = ref(false)
const pwdError = ref('')
const pwdOk = ref('')

/** 弹窗标题：主路径用品牌名，次级路径用动作名（对齐 GitHub / Linear） */
const dialogTitle = computed(() => {
  if (account.authMode === 'otp') return t('account.otpLoginTitle')
  if (account.authMode === 'reset') return t('account.resetTitle')
  return t('account.authBrand')
})

const authSubtitle = computed(() => {
  if (account.authMode === 'register') return t('account.authSubtitleRegister')
  if (account.authMode === 'otp') return t('account.authSubtitleOtp')
  if (account.authMode === 'reset') return t('account.authSubtitleReset')
  return t('account.authSubtitleLogin')
})

/** 主分段：登录 / 注册；OTP 与重置走次级链路 */
const showMainSegment = computed(
  () => account.authMode === 'login' || account.authMode === 'register',
)

const needsOtpStep = computed(
  () =>
    account.authMode === 'register' ||
    account.authMode === 'otp' ||
    account.authMode === 'reset',
)

const showPasswordField = computed(
  () =>
    account.authMode === 'login' ||
    (account.authMode === 'register' && otpSent.value) ||
    (account.authMode === 'reset' && otpSent.value),
)

const passwordLabel = computed(() =>
  account.authMode === 'reset' ? t('account.passwordNew') : t('account.password'),
)

watch(
  () => account.authOpen,
  (open) => {
    if (open) {
      error.value = ''
      info.value = ''
      otpSent.value = false
      password.value = ''
      code.value = ''
      stopOtpCooldown()
    }
  },
)

watch(
  () => account.passwordChangeOpen,
  (open) => {
    if (open) {
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      pwdError.value = ''
      pwdOk.value = ''
    }
  },
)

onUnmounted(() => {
  stopOtpCooldown()
})

function startOtpCooldown(sec = OTP_RESEND_COOLDOWN_SEC): void {
  stopOtpCooldown()
  otpCooldown.value = sec
  otpTimer = setInterval(() => {
    otpCooldown.value -= 1
    if (otpCooldown.value <= 0) stopOtpCooldown()
  }, 1000)
}

function stopOtpCooldown(): void {
  if (otpTimer) {
    clearInterval(otpTimer)
    otpTimer = null
  }
  otpCooldown.value = 0
}

function isNetworkFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  )
}

function errMsg(e: unknown): string {
  if (e instanceof CloudApiError) {
    const key = `account.errors.${e.code}`
    if (te(key)) return t(key)
    return e.code
  }
  if (isNetworkFailure(e)) {
    return t('account.errors.network_error')
  }
  if (e instanceof Error) {
    const key = `account.errors.${e.message}`
    if (te(key)) return t(key)
    return e.message
  }
  return t('account.errors.server_error')
}

function isValidEmail(value: string): boolean {
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

function validatePassword(pw: string): string | null {
  if (!pw) return t('account.validation.passwordRequired')
  const n = [...pw].length
  if (n < PASSWORD_MIN_LEN || n > PASSWORD_MAX_LEN) {
    return t('account.validation.passwordLength')
  }
  return null
}

function validateAuthForm(stage: 'sendOtp' | 'submit'): string | null {
  const em = email.value.trim()
  if (!em) return t('account.validation.emailRequired')
  if (!isValidEmail(em)) return t('account.validation.emailInvalid')

  if (account.authMode === 'login') {
    return validatePassword(password.value)
  }

  if (stage === 'sendOtp') return null

  if (needsOtpStep.value) {
    if (!code.value.trim()) return t('account.validation.codeRequired')
  }
  if (account.authMode === 'register' || account.authMode === 'reset') {
    return validatePassword(password.value)
  }
  return null
}

async function onAuthSubmit(): Promise<void> {
  busy.value = true
  error.value = ''
  info.value = ''
  try {
    if (account.authMode === 'login') {
      const v = validateAuthForm('submit')
      if (v) {
        error.value = v
        return
      }
      await account.doLoginPassword(email.value.trim(), password.value)
      return
    }

    if (!otpSent.value) {
      const v = validateAuthForm('sendOtp')
      if (v) {
        error.value = v
        return
      }
      if (account.authMode === 'register') {
        await account.doRegisterStart(email.value.trim())
      } else if (account.authMode === 'otp') {
        await account.doLoginOtpStart(email.value.trim())
      } else {
        await account.doPasswordForgot(email.value.trim())
      }
      otpSent.value = true
      startOtpCooldown()
      return
    }

    const v = validateAuthForm('submit')
    if (v) {
      error.value = v
      return
    }

    if (account.authMode === 'register') {
      await account.doRegisterComplete({
        email: email.value.trim(),
        code: code.value.trim(),
        password: password.value,
        displayName: displayName.value.trim() || undefined,
      })
    } else if (account.authMode === 'otp') {
      await account.doLoginOtpComplete(email.value.trim(), code.value.trim())
    } else if (account.authMode === 'reset') {
      await account.doPasswordReset(email.value.trim(), code.value.trim(), password.value)
      info.value = t('account.resetDone')
      otpSent.value = false
      code.value = ''
      password.value = ''
      stopOtpCooldown()
    }
  } catch (e) {
    error.value = errMsg(e)
    if (e instanceof CloudApiError && e.code === 'otp_cooldown') {
      if (otpCooldown.value <= 0) startOtpCooldown()
    }
  } finally {
    busy.value = false
  }
}

async function onResendOtp(): Promise<void> {
  if (otpCooldown.value > 0 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const v = validateAuthForm('sendOtp')
    if (v) {
      error.value = v
      return
    }
    if (account.authMode === 'register') {
      await account.doRegisterStart(email.value.trim())
    } else if (account.authMode === 'otp') {
      await account.doLoginOtpStart(email.value.trim())
    } else if (account.authMode === 'reset') {
      await account.doPasswordForgot(email.value.trim())
    }
    startOtpCooldown()
  } catch (e) {
    error.value = errMsg(e)
    if (e instanceof CloudApiError && e.code === 'otp_cooldown') {
      if (otpCooldown.value <= 0) startOtpCooldown()
    }
  } finally {
    busy.value = false
  }
}

function switchMode(mode: AuthMode): void {
  account.authMode = mode
  error.value = ''
  info.value = ''
  otpSent.value = false
  code.value = ''
  password.value = ''
  stopOtpCooldown()
}

function onAuthOpenChange(open: boolean): void {
  if (!open) account.closeAuth()
}

function onPasswordChangeOpenChange(open: boolean): void {
  if (!open) account.closePasswordChange()
}

async function onPasswordChangeSubmit(): Promise<void> {
  pwdBusy.value = true
  pwdError.value = ''
  pwdOk.value = ''
  try {
    const cur = currentPassword.value
    if (!cur) {
      pwdError.value = t('account.validation.currentPasswordRequired')
      return
    }
    const pwErr = validatePassword(newPassword.value)
    if (pwErr) {
      pwdError.value = pwErr
      return
    }
    if (newPassword.value !== confirmPassword.value) {
      pwdError.value = t('account.validation.passwordMismatch')
      return
    }
    if (newPassword.value === cur) {
      pwdError.value = t('account.validation.passwordSame')
      return
    }
    await account.doPasswordChange(cur, newPassword.value)
    pwdOk.value = t('account.passwordChangeDone')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    if (e instanceof CloudApiError && e.code === 'invalid_credentials') {
      pwdError.value = t('account.errors.wrong_current_password')
    } else {
      pwdError.value = errMsg(e)
    }
  } finally {
    pwdBusy.value = false
  }
}

const primaryLabel = computed(() => {
  if (account.authMode === 'login') return t('account.login')
  if (!otpSent.value) return t('account.sendOtp')
  if (account.authMode === 'register') return t('account.register')
  if (account.authMode === 'reset') return t('account.resetSubmit')
  return t('account.login')
})
</script>

<template>
  <div id="nm-account-auth-portal" class="nm-auth-shell">
    <RsDialog
      :open="account.authOpen"
      :title="dialogTitle"
      :description="authSubtitle"
      width="sm"
      layout="form"
      teleport-to="#nm-account-auth-portal"
      :resizable="false"
      :draggable="false"
      :fullscreenable="false"
      :show-overlay="true"
      :show-close="true"
      :close-on-overlay-click="true"
      @update:open="onAuthOpenChange"
    >
      <template #body>
        <form class="nm-auth" @submit.prevent="onAuthSubmit">
          <div v-if="showMainSegment" class="nm-auth__segment" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="account.authMode === 'login'"
              :class="{ 'nm-auth__segment-btn--active': account.authMode === 'login' }"
              class="nm-auth__segment-btn"
              @click="switchMode('login')"
            >
              {{ t('account.loginTitle') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="account.authMode === 'register'"
              :class="{ 'nm-auth__segment-btn--active': account.authMode === 'register' }"
              class="nm-auth__segment-btn"
              @click="switchMode('register')"
            >
              {{ t('account.tabRegister') }}
            </button>
          </div>
          <button v-else type="button" class="nm-auth__back" @click="switchMode('login')">
            ← {{ t('account.backToLogin') }}
          </button>

          <div class="nm-auth__fields">
            <label class="nm-auth__field">
              <span class="nm-auth__label">{{ t('account.email') }}</span>
              <RsInput v-model="email" type="email" autocomplete="username" />
            </label>

            <label v-if="account.authMode === 'register'" class="nm-auth__field">
              <span class="nm-auth__label">
                {{ t('account.displayName') }}
                <span class="nm-auth__optional">{{ t('account.displayNameOptional') }}</span>
              </span>
              <RsInput v-model="displayName" autocomplete="nickname" />
            </label>

            <label v-if="showPasswordField" class="nm-auth__field">
              <span class="nm-auth__label">
                {{ passwordLabel }}
                <span
                  v-if="account.authMode === 'register' || account.authMode === 'reset'"
                  class="nm-auth__optional"
                >
                  {{ t('account.passwordHint') }}
                </span>
              </span>
              <RsInput
                v-model="password"
                type="password"
                :autocomplete="account.authMode === 'login' ? 'current-password' : 'new-password'"
              />
            </label>

            <label v-if="needsOtpStep && otpSent" class="nm-auth__field">
              <span class="nm-auth__label">{{ t('account.otpCode') }}</span>
              <RsInput v-model="code" />
            </label>
          </div>

          <div v-if="otpSent && needsOtpStep" class="nm-auth__otp-row">
            <p class="nm-auth__hint">{{ t('account.otpHint') }}</p>
            <button
              type="button"
              class="nm-auth__link"
              :disabled="busy || otpCooldown > 0"
              @click="onResendOtp"
            >
              <template v-if="otpCooldown > 0">
                {{ t('account.otpResendIn', { sec: otpCooldown }) }}
              </template>
              <template v-else>{{ t('account.otpResend') }}</template>
            </button>
          </div>

          <div v-else-if="account.authMode === 'login'" class="nm-auth__links">
            <button type="button" class="nm-auth__link" @click="switchMode('otp')">
              {{ t('account.switchToOtp') }}
            </button>
            <button type="button" class="nm-auth__link" @click="switchMode('reset')">
              {{ t('account.forgotPassword') }}
            </button>
          </div>
          <div v-else-if="account.authMode === 'otp'" class="nm-auth__links">
            <button type="button" class="nm-auth__link" @click="switchMode('login')">
              {{ t('account.switchToPassword') }}
            </button>
          </div>

          <p v-if="error" class="nm-auth__error" role="alert">{{ error }}</p>
          <p v-if="info" class="nm-auth__ok" role="status">{{ info }}</p>

          <RsButton
            class="nm-auth__submit"
            type="submit"
            variant="primary"
            :loading="busy"
            :disabled="busy"
          >
            {{ primaryLabel }}
          </RsButton>

          <p class="nm-auth__legal">{{ t('account.authLegal') }}</p>
        </form>
      </template>
    </RsDialog>
  </div>

  <div id="nm-account-pwd-portal" class="nm-auth-shell">
    <RsDialog
      :open="account.passwordChangeOpen"
      :title="t('account.passwordChangeTitle')"
      :description="t('account.passwordChangeSubtitle')"
      width="sm"
      layout="form"
      teleport-to="#nm-account-pwd-portal"
      :resizable="false"
      :draggable="false"
      :fullscreenable="false"
      :show-overlay="true"
      :show-close="true"
      :close-on-overlay-click="true"
      @update:open="onPasswordChangeOpenChange"
    >
      <template #body>
        <form class="nm-auth" @submit.prevent="onPasswordChangeSubmit">
          <div class="nm-auth__fields">
            <label class="nm-auth__field">
              <span class="nm-auth__label">{{ t('account.passwordCurrent') }}</span>
              <RsInput
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
              />
            </label>
            <label class="nm-auth__field">
              <span class="nm-auth__label">
                {{ t('account.passwordNew') }}
                <span class="nm-auth__optional">{{ t('account.passwordHint') }}</span>
              </span>
              <RsInput v-model="newPassword" type="password" autocomplete="new-password" />
            </label>
            <label class="nm-auth__field">
              <span class="nm-auth__label">{{ t('account.passwordConfirm') }}</span>
              <RsInput v-model="confirmPassword" type="password" autocomplete="new-password" />
            </label>
          </div>

          <p v-if="pwdError" class="nm-auth__error" role="alert">{{ pwdError }}</p>
          <p v-if="pwdOk" class="nm-auth__ok" role="status">{{ pwdOk }}</p>

          <RsButton
            class="nm-auth__submit"
            type="submit"
            variant="primary"
            :loading="pwdBusy"
            :disabled="pwdBusy"
          >
            {{ t('account.passwordChangeSubmit') }}
          </RsButton>
        </form>
      </template>
    </RsDialog>
  </div>

  <FeedbackHost />
</template>

<style scoped>
/* 收紧 form 弹窗 chrome，接近主流 Auth sheet */
.nm-auth-shell :deep(.rs-dialog__overlay) {
  background: rgb(0 0 0 / 0.08);
  backdrop-filter: blur(4px) saturate(110%);
  -webkit-backdrop-filter: blur(4px) saturate(110%);
}

.nm-auth-shell :deep(.rs-dialog__content--sm) {
  max-width: 22.5rem;
}

.nm-auth-shell :deep(.rs-dialog__header) {
  padding: 1rem 1.1rem 0.35rem;
  border-bottom: none;
  background: transparent;
}

.nm-auth-shell :deep(.rs-dialog__title) {
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.nm-auth-shell :deep(.rs-dialog__description) {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--rs-muted);
}

.nm-auth-shell :deep(.rs-dialog__body) {
  padding: 0.35rem 1.1rem 1.15rem;
}

.nm-auth-shell :deep(.rs-dialog__actions .rs-btn) {
  color: var(--rs-muted);
}

.nm-auth {
  display: grid;
  gap: 0.75rem;
  color: var(--rs-text);
}

.nm-auth__segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem;
  padding: 0.18rem;
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--rs-text) 6%, var(--rs-surface));
}

.nm-auth__segment-btn {
  border: none;
  outline: none;
  background: transparent;
  color: var(--rs-muted);
  border-radius: 0.42rem;
  padding: 0.4rem 0.5rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 550;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.nm-auth__segment-btn:hover {
  color: var(--rs-text);
}

.nm-auth__segment-btn--active {
  color: var(--rs-text);
  background: var(--rs-surface-elevated, var(--rs-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--rs-border) 80%, transparent);
}

.nm-auth__back {
  justify-self: start;
  border: none;
  background: none;
  color: var(--rs-primary);
  font: inherit;
  font-size: 0.8rem;
  padding: 0;
  cursor: pointer;
}

.nm-auth__back:hover {
  color: var(--rs-primary-hover);
}

.nm-auth__fields {
  display: grid;
  gap: 0.65rem;
}

.nm-auth__field {
  display: grid;
  gap: 0.3rem;
}

.nm-auth__label {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 550;
  color: var(--rs-muted);
}

.nm-auth__optional {
  font-weight: 400;
  opacity: 0.85;
}

.nm-auth__links,
.nm-auth__otp-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.85rem;
  margin-top: -0.15rem;
}

.nm-auth__link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.78rem;
  color: var(--rs-primary);
  cursor: pointer;
}

.nm-auth__link:hover {
  color: var(--rs-primary-hover);
}

.nm-auth__link:disabled {
  color: var(--rs-muted);
  cursor: not-allowed;
}

.nm-auth__hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--rs-muted);
  line-height: 1.45;
}

.nm-auth__error {
  margin: 0;
  font-size: 0.82rem;
  color: var(--rs-danger);
}

.nm-auth__ok {
  margin: 0;
  font-size: 0.82rem;
  color: var(--rs-success);
}

.nm-auth__submit {
  width: 100%;
  margin-top: 0.2rem;
  justify-content: center;
}

.nm-auth__legal {
  margin: 0;
  text-align: center;
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--rs-muted);
  opacity: 0.9;
}

</style>
