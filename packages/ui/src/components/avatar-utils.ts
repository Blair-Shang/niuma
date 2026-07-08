/** 头像尺寸 */
export type RsAvatarSize = 'sm' | 'md' | 'lg'

/** 头像形状 */
export type RsAvatarShape = 'circle' | 'square'

/** 头像占位色调 */
export type RsAvatarTone = 'default' | 'primary' | 'success' | 'warning' | 'danger'

/**
 * 从姓名提取缩写（最多 2 个字符）。
 * @param name 显示名称
 */
export function getAvatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}
