/**
 * AI 图片附件：压缩截图 / 粘贴图为 data URL，控制体积。
 */

export interface AiImageAttachment {
  id: string
  dataUrl: string
  mimeType: string
  width: number
  height: number
  /** 原始字节近似（base64 解码前估算） */
  byteLength: number
}

const MAX_IMAGES = 3
const MAX_EDGE = 1536
const MAX_BYTES = 700_000 // 单张压缩后上限（约）
const JPEG_QUALITY = 0.82

/** 从 Clipboard / File 读取并压缩。 */
export async function fileToAiImage(file: Blob, id?: string): Promise<AiImageAttachment | null> {
  if (!file.type.startsWith('image/')) {
    return null
  }
  const bitmap = await createImageBitmap(file)
  try {
    const { canvas, width, height } = drawScaled(bitmap, MAX_EDGE)
    let mimeType = 'image/jpeg'
    let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    if (estimateDataUrlBytes(dataUrl) > MAX_BYTES) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.65)
    }
    if (estimateDataUrlBytes(dataUrl) > MAX_BYTES) {
      // 再缩小一边
      const again = drawScaled(bitmap, Math.floor(MAX_EDGE * 0.7))
      dataUrl = again.canvas.toDataURL('image/jpeg', 0.6)
      mimeType = 'image/jpeg'
      return {
        id: id || `img:${Date.now().toString(36)}`,
        dataUrl,
        mimeType,
        width: again.width,
        height: again.height,
        byteLength: estimateDataUrlBytes(dataUrl),
      }
    }
    return {
      id: id || `img:${Date.now().toString(36)}`,
      dataUrl,
      mimeType,
      width,
      height,
      byteLength: estimateDataUrlBytes(dataUrl),
    }
  } finally {
    bitmap.close()
  }
}

function drawScaled(
  bitmap: ImageBitmap,
  maxEdge: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  let width = bitmap.width
  let height = bitmap.height
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('canvas unavailable')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { canvas, width, height }
}

function estimateDataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
  return Math.floor((b64.length * 3) / 4)
}

/** 编码进用户消息（落库 + 展示）。 */
export function encodeImageMarkers(images: AiImageAttachment[]): string {
  if (!images.length) {
    return ''
  }
  return images.map((img) => `⟦nm-img:${img.dataUrl}⟧`).join('\n') + '\n\n'
}

const nmImgRe = /⟦nm-img:(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)⟧/g

/** 从消息正文提取图片 data URL，并返回去掉标记后的文本。 */
export function extractImageMarkers(source: string): { text: string; images: string[] } {
  const images: string[] = []
  const text = source.replace(nmImgRe, (_m, dataUrl: string) => {
    if (images.length < MAX_IMAGES) {
      images.push(dataUrl)
    }
    return ''
  })
  return { text: text.replace(/^\s+/, '').replace(/\s+$/, ''), images }
}

export function canAddMoreImages(currentCount: number): boolean {
  return currentCount < MAX_IMAGES
}

export const AI_IMAGE_MAX_COUNT = MAX_IMAGES
