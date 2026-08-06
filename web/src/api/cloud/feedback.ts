import { cloudApiBase, cloudFetch } from './client'

export type FeedbackImageInput = {
  name: string
  contentType: string
  data: string // data URL 或 base64
}

export type FeedbackInput = {
  category: string
  title: string
  body: string
  contact?: string
  product?: string
  clientVersion?: string
  images?: FeedbackImageInput[]
}

export type FeedbackAttachment = {
  id: string
  name: string
  contentType: string
  size: number
  file?: string
}

/** 用户可见的反馈（含运营回复，无内部备注） */
export type FeedbackItem = {
  id: string
  userId?: string
  category: string
  title: string
  body: string
  contact?: string
  product?: string
  clientVersion?: string
  status: string
  staffReply?: string
  staffReplyAt?: string | null
  attachments?: FeedbackAttachment[]
  createdAt: string
  updatedAt?: string
}

export async function submitFeedback(
  input: FeedbackInput,
  accessToken?: string | null,
): Promise<{ id: string }> {
  return cloudFetch('/api/v1/feedback', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      category: input.category,
      title: input.title,
      body: input.body,
      contact: input.contact || '',
      product: input.product || 'niuma',
      clientVersion: input.clientVersion || '',
      images: input.images || [],
    }),
  })
}

export async function listMyFeedback(accessToken: string): Promise<FeedbackItem[]> {
  const res = await cloudFetch<{ items: FeedbackItem[] }>('/api/v1/feedback/mine', {
    accessToken,
  })
  return res.items || []
}

/** 带鉴权拉取截图，返回可展示的 blob URL（调用方负责 revoke）。 */
export async function fetchFeedbackAttachmentURL(
  feedbackId: string,
  attachmentId: string,
  accessToken: string,
): Promise<string> {
  const res = await fetch(
    `${cloudApiBase()}/api/v1/feedback/${encodeURIComponent(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: {
        Accept: 'image/*,*/*',
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  if (!res.ok) {
    throw new Error(`http_${res.status}`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
