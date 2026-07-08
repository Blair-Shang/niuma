export interface RsUploadValidationRules {
  accept?: string
  maxSize?: number
  maxCount?: number
}

export interface RsUploadValidationError {
  file: File
  reason: 'accept' | 'maxSize' | 'maxCount'
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function isFileAccepted(file: File, accept?: string): boolean {
  if (!accept) return true
  const rules = accept.split(',').map((item) => item.trim()).filter(Boolean)
  return rules.some((rule) => {
    if (rule.startsWith('.')) return file.name.toLowerCase().endsWith(rule.toLowerCase())
    if (rule.endsWith('/*')) return file.type.startsWith(rule.slice(0, -1))
    return file.type === rule
  })
}

export function validateUploadFiles(
  files: readonly File[],
  rules: RsUploadValidationRules = {},
): { accepted: File[]; rejected: RsUploadValidationError[] } {
  const accepted: File[] = []
  const rejected: RsUploadValidationError[] = []
  for (const file of files) {
    if (rules.maxCount && accepted.length >= rules.maxCount) {
      rejected.push({ file, reason: 'maxCount' })
    } else if (!isFileAccepted(file, rules.accept)) {
      rejected.push({ file, reason: 'accept' })
    } else if (rules.maxSize && file.size > rules.maxSize) {
      rejected.push({ file, reason: 'maxSize' })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, rejected }
}

export function mergeUploadFiles(current: readonly File[], next: readonly File[], maxCount?: number): File[] {
  const merged = [...current, ...next]
  return maxCount ? merged.slice(0, maxCount) : merged
}

export function removeUploadFileAt(files: readonly File[], index: number): File[] {
  return files.filter((_, currentIndex) => currentIndex !== index)
}
