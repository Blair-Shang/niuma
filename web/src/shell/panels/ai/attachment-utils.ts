/**
 * AI Composer 附件：图片（Vision）+ 文本文件（入模为 fenced 正文）。
 */
import {
  AI_IMAGE_MAX_COUNT,
  canAddMoreImages,
  encodeImageMarkers,
  extractImageMarkers,
  fileToAiImage,
  type AiImageAttachment,
} from './image-utils'

export type { AiImageAttachment }
export {
  AI_IMAGE_MAX_COUNT,
  canAddMoreImages,
  encodeImageMarkers,
  extractImageMarkers,
  fileToAiImage,
}

export interface AiTextAttachment {
  id: string
  name: string
  mimeType: string
  text: string
  byteLength: number
}

export type AiComposerFile =
  | ({ kind: 'image' } & AiImageAttachment)
  | ({ kind: 'text' } & AiTextAttachment)

/** 图片 + 文本合计上限。 */
export const AI_FILE_MAX_COUNT = 5
/** 单份文本体积上限（字符，约等于 UTF-8 字节量级）。 */
export const AI_TEXT_MAX_CHARS = 100_000

const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'sql',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'xml',
  'csv',
  'tsv',
  'log',
  'conf',
  'cfg',
  'ini',
  'toml',
  'env',
  'go',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'sh',
  'bash',
  'ps1',
  'bat',
  'cmd',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'vue',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'r',
  'pl',
  'lua',
  'dockerfile',
  'gitignore',
  'editorconfig',
])

export function canAddMoreFiles(currentCount: number): boolean {
  return currentCount < AI_FILE_MAX_COUNT
}

export function isImageFile(file: File | Blob): boolean {
  return Boolean(file.type?.startsWith('image/'))
}

export function isTextFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (mime.startsWith('text/')) {
    return true
  }
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/sql' ||
    mime === 'application/x-sql' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-yaml' ||
    mime === 'application/yaml'
  ) {
    return true
  }
  const name = file.name || ''
  const base = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return TEXT_EXTS.has(base.toLowerCase())
}

export async function fileToAiText(file: File, id?: string): Promise<AiTextAttachment | null> {
  if (!isTextFile(file)) {
    return null
  }
  const text = await file.text()
  if (text.length > AI_TEXT_MAX_CHARS) {
    throw new Error('text-too-large')
  }
  // 拒绝明显二进制（NUL 比例过高）
  const sample = text.slice(0, 4000)
  let nul = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) {
      nul++
    }
  }
  if (nul > 0) {
    return null
  }
  return {
    id: id || `txt:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || 'untitled.txt',
    mimeType: file.type || 'text/plain',
    text,
    byteLength: text.length,
  }
}

/** 编码文本附件标记（落库 + 入模）。 */
export function encodeTextMarkers(files: AiTextAttachment[]): string {
  if (!files.length) {
    return ''
  }
  return (
    files
      .map((f) => {
        const name = encodeURIComponent(f.name)
        return `⟦nm-txt:${name}⟧\n${f.text}\n⟦/nm-txt⟧`
      })
      .join('\n') + '\n\n'
  )
}

export function encodeFileMarkers(files: AiComposerFile[]): string {
  const images = files.filter((f): f is Extract<AiComposerFile, { kind: 'image' }> => f.kind === 'image')
  const texts = files.filter((f): f is Extract<AiComposerFile, { kind: 'text' }> => f.kind === 'text')
  return encodeImageMarkers(images) + encodeTextMarkers(texts)
}

const nmTxtRe = /⟦nm-txt:([^⟧]*)⟧\n?([\s\S]*?)\n?⟦\/nm-txt⟧/g

export interface ExtractedTextFile {
  name: string
  text: string
}

/** 从消息正文提取文本附件，返回去掉标记后的文本。 */
export function extractTextMarkers(source: string): { text: string; files: ExtractedTextFile[] } {
  const files: ExtractedTextFile[] = []
  const text = source.replace(nmTxtRe, (_m, encName: string, body: string) => {
    let name = encName
    try {
      name = decodeURIComponent(encName)
    } catch {
      // keep raw
    }
    if (files.length < AI_FILE_MAX_COUNT) {
      files.push({ name, text: body.replace(/^\n/, '').replace(/\n$/, '') })
    }
    return ''
  })
  return { text: text.replace(/^\s+/, '').replace(/\s+$/, ''), files }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 文件选择器 accept。 */
export const AI_FILE_ACCEPT = [
  'image/*',
  'text/*',
  '.sql',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.log',
  '.toml',
  '.ini',
  '.conf',
  '.go',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.sh',
  '.ps1',
  '.vue',
  '.css',
  '.html',
].join(',')
