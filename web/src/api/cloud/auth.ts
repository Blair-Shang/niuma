import { cloudFetch } from './client'

export type CloudUser = {
  id: string
  email: string
  displayName: string
  emailVerifiedAt?: string | null
  status: string
  createdAt: string
}

export type AuthSession = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  user: CloudUser
}

export async function registerStart(email: string): Promise<void> {
  await cloudFetch('/api/v1/auth/register/start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function registerComplete(input: {
  email: string
  code: string
  password: string
  displayName?: string
}): Promise<AuthSession> {
  return cloudFetch('/api/v1/auth/register/complete', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'X-Device-Label': 'NiuMa Desktop' },
  })
}

export async function loginPassword(email: string, password: string): Promise<AuthSession> {
  return cloudFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'X-Device-Label': 'NiuMa Desktop' },
  })
}

export async function loginOtpStart(email: string): Promise<void> {
  await cloudFetch('/api/v1/auth/login/otp/start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function loginOtpComplete(email: string, code: string): Promise<AuthSession> {
  return cloudFetch('/api/v1/auth/login/otp/complete', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
    headers: { 'X-Device-Label': 'NiuMa Desktop' },
  })
}

export async function refreshAccess(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: string
  user: CloudUser
}> {
  return cloudFetch('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  })
}

export async function logout(refreshToken: string): Promise<void> {
  await cloudFetch('/api/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  })
}

export async function fetchMe(accessToken: string): Promise<CloudUser> {
  return cloudFetch('/api/v1/me', { accessToken })
}

export async function passwordForgot(email: string): Promise<void> {
  await cloudFetch('/api/v1/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function passwordReset(email: string, code: string, password: string): Promise<void> {
  await cloudFetch('/api/v1/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ email, code, password }),
  })
}

/** 登录态修改密码（需当前密码） */
export async function passwordChange(
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await cloudFetch('/api/v1/auth/password/change', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function patchMe(
  accessToken: string,
  displayName: string,
): Promise<CloudUser> {
  return cloudFetch('/api/v1/me', {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify({ displayName }),
  })
}
