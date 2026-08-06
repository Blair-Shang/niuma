<script setup lang="ts">
import {
  RsBadge,
  RsButton,
  RsCard,
  RsDialog,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLabel,
  RsLoading,
  RsTabs,
  RsUpload,
  type RsTabItem,
} from '@niuma/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudApiError } from '@/api/cloud/client'
import {
  fetchFeedbackAttachmentURL,
  type FeedbackAttachment,
  type FeedbackImageInput,
  type FeedbackItem,
} from '@/api/cloud/feedback'
import { useAccountStore } from '@/stores/account'
import { useBridgeStore } from '@/stores/bridge'

const { t, te } = useI18n()
const account = useAccountStore()
const bridgeStore = useBridgeStore()

const fbCategory = ref('bug')
const fbTitle = ref('')
const fbBody = ref('')
const fbBusy = ref(false)
const fbError = ref('')
const fbDone = ref(false)
const fbTab = ref('new')
const fbMine = ref<FeedbackItem[]>([])
const fbMineBusy = ref(false)
const fbMineError = ref('')
const uploadFiles = ref<File[]>([])
const attPreview = ref<Record<string, string>>({})
const lightbox = ref<string | null>(null)
const previewUrls = ref<string[]>([])

const MAX_IMAGES = 3
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.84
const MAX_FILE_BYTES = 2 << 20

const bodyCount = computed(() => [...fbBody.value].length)
const canSubmit = computed(
  () => !!fbTitle.value.trim() && !!fbBody.value.trim() && !fbBusy.value,
)
const hasUploads = computed(() => uploadFiles.value.length > 0)
const uploadHint = computed(() =>
  hasUploads.value
    ? t('account.feedbackDropMore', { n: uploadFiles.value.length, max: MAX_IMAGES })
    : t('account.feedbackDropHint'),
)

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const tabItems = computed<RsTabItem[]>(() => [
  { value: 'new', label: t('account.feedbackTabNew') },
  { value: 'mine', label: t('account.feedbackTabMine') },
])

const categoryOptions = computed(() => [
  { value: 'bug', label: t('account.catBug') },
  { value: 'feature', label: t('account.catFeature') },
  { value: 'other', label: t('account.catOther') },
])

watch(
  () => account.feedbackOpen,
  (open) => {
    if (open) {
      fbError.value = ''
      fbDone.value = false
      fbMineError.value = ''
      fbTab.value = 'new'
      void loadMyFeedback()
    } else {
      clearUploads()
      revokeAttPreviews()
      lightbox.value = null
    }
  },
)

watch(fbTab, (tab) => {
  if (tab === 'mine' && account.feedbackOpen) {
    void loadMyFeedback()
  }
})

watch(
  uploadFiles,
  (files) => {
    for (const url of previewUrls.value) URL.revokeObjectURL(url)
    previewUrls.value = files.map((f) => URL.createObjectURL(f))
  },
  { deep: true },
)

onUnmounted(() => {
  clearUploads()
  revokeAttPreviews()
})

function errMsg(e: unknown): string {
  if (e instanceof CloudApiError) {
    const key = `account.errors.${e.code}`
    if (te(key)) return t(key)
    return e.code
  }
  if (e instanceof Error) {
    const msg = e.message.toLowerCase()
    if (msg.includes('failed to fetch') || msg.includes('network')) {
      return t('account.errors.network_error')
    }
    const key = `account.errors.${e.message}`
    if (te(key)) return t(key)
    return e.message
  }
  return t('account.errors.server_error')
}

function statusVariant(status: string): 'default' | 'primary' | 'success' | 'warning' {
  if (status === 'closed') return 'success'
  if (status === 'triaged') return 'primary'
  if (status === 'open') return 'warning'
  return 'default'
}

function statusLabel(status: string): string {
  const key = `account.feedbackStatus.${status}`
  return te(key) ? t(key) : status
}

function catLabel(cat: string): string {
  if (cat === 'bug') return t('account.catBug')
  if (cat === 'feature') return t('account.catFeature')
  return t('account.catOther')
}

function formatTime(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return iso
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

async function loadMyFeedback(): Promise<void> {
  if (!account.isLoggedIn) {
    fbMine.value = []
    return
  }
  fbMineBusy.value = true
  fbMineError.value = ''
  try {
    fbMine.value = await account.fetchMyFeedback()
    await hydrateAttachments(fbMine.value)
  } catch (e) {
    fbMineError.value = errMsg(e)
  } finally {
    fbMineBusy.value = false
  }
}

function revokeAttPreviews(): void {
  for (const url of Object.values(attPreview.value)) {
    URL.revokeObjectURL(url)
  }
  attPreview.value = {}
}

async function hydrateAttachments(items: FeedbackItem[]): Promise<void> {
  const token = account.accessToken
  if (!token) return
  revokeAttPreviews()
  const next: Record<string, string> = {}
  for (const item of items) {
    for (const att of item.attachments || []) {
      const key = `${item.id}:${att.id}`
      try {
        next[key] = await fetchFeedbackAttachmentURL(item.id, att.id, token)
      } catch {
        /* ignore */
      }
    }
  }
  attPreview.value = next
}

function attKey(itemId: string, att: FeedbackAttachment): string {
  return `${itemId}:${att.id}`
}

function clearUploads(): void {
  for (const url of previewUrls.value) URL.revokeObjectURL(url)
  previewUrls.value = []
  uploadFiles.value = []
}

function onUploadReject(): void {
  fbError.value = t('account.feedbackImageFailed')
}

async function compressImage(file: File): Promise<FeedbackImageInput> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return {
      name: file.name.replace(/\.\w+$/, '') + '.jpg',
      contentType: 'image/jpeg',
      data: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
    }
  } finally {
    bitmap.close()
  }
}

function onPaste(ev: ClipboardEvent): void {
  const items = ev.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue
      ev.preventDefault()
      if (uploadFiles.value.length >= MAX_IMAGES) {
        fbError.value = t('account.feedbackImageMax', { n: MAX_IMAGES })
        return
      }
      uploadFiles.value = [...uploadFiles.value, file]
      return
    }
  }
}

async function onFeedbackSubmit(): Promise<void> {
  fbBusy.value = true
  fbError.value = ''
  fbDone.value = false
  try {
    if (!account.isLoggedIn) {
      account.closeFeedback()
      account.openFeedback()
      return
    }
    if (!fbTitle.value.trim()) {
      fbError.value = t('account.validation.titleRequired')
      return
    }
    if (!fbBody.value.trim()) {
      fbError.value = t('account.validation.bodyRequired')
      return
    }
    let images: FeedbackImageInput[] = []
    try {
      images = await Promise.all(uploadFiles.value.map((f) => compressImage(f)))
    } catch {
      fbError.value = t('account.feedbackImageFailed')
      return
    }
    await account.sendFeedback({
      category: fbCategory.value,
      title: fbTitle.value.trim(),
      body: fbBody.value.trim(),
      contact: account.user?.email || '',
      product: 'niuma',
      clientVersion: bridgeStore.shellVersion?.trim() || '',
      images,
    })
    fbDone.value = true
    fbTitle.value = ''
    fbBody.value = ''
    clearUploads()
    fbTab.value = 'mine'
    await loadMyFeedback()
  } catch (e) {
    fbError.value = errMsg(e)
  } finally {
    fbBusy.value = false
  }
}

function onFeedbackOpenChange(open: boolean): void {
  if (!open) account.closeFeedback()
}

function removeUploadAt(index: number): void {
  uploadFiles.value = uploadFiles.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="nm-fb-shell">
  <RsDialog
    :open="account.feedbackOpen"
    :title="t('account.feedbackTitle')"
    :description="t('account.feedbackDesc')"
    width="lg"
    layout="window"
    :modal="false"
    :show-overlay="false"
    :show-close="true"
    :close-on-overlay-click="false"
    :draggable="true"
    :resizable="true"
    :fullscreenable="true"
    @update:open="onFeedbackOpenChange"
  >
    <template #body>
      <div class="nm-fb">
        <RsTabs v-model="fbTab" class="nm-fb__tabs" :items="tabItems" variant="segmented" size="sm">
          <template #new>
            <div class="nm-fb__pane">
              <p class="nm-fb__lead">{{ t('account.feedbackLoginHint') }}</p>

              <div class="nm-fb__cats" :aria-label="t('account.feedbackCategory')">
                <RsButton
                  v-for="opt in categoryOptions"
                  :key="opt.value"
                  size="sm"
                  :variant="fbCategory === opt.value ? 'primary' : 'ghost'"
                  @click="fbCategory = opt.value"
                >
                  {{ opt.label }}
                </RsButton>
              </div>

              <div class="nm-fb__field">
                <RsLabel for-id="nm-fb-title">{{ t('account.feedbackTitlePh') }}</RsLabel>
                <RsInput
                  id="nm-fb-title"
                  v-model="fbTitle"
                  :placeholder="t('account.feedbackTitlePlaceholder')"
                />
              </div>

              <div class="nm-fb__field">
                <RsLabel for-id="nm-fb-body" :hint="`${bodyCount}/8000`">
                  {{ t('account.feedbackBodyPh') }}
                </RsLabel>
                <textarea
                  id="nm-fb-body"
                  v-model="fbBody"
                  class="nm-fb__textarea"
                  rows="6"
                  maxlength="8000"
                  :placeholder="t('account.feedbackBodyPlaceholder')"
                  @paste="onPaste"
                />
              </div>

              <div class="nm-fb__field">
                <RsLabel :hint="t('account.feedbackImagesHint', { n: MAX_IMAGES })">
                  {{ t('account.feedbackImages') }}
                </RsLabel>
                <div class="nm-fb__media" :class="{ 'nm-fb__media--filled': hasUploads }">
                  <ul v-if="hasUploads" class="nm-fb__gallery">
                    <li v-for="(url, index) in previewUrls" :key="url" class="nm-fb__shot">
                      <button
                        type="button"
                        class="nm-fb__shot-preview"
                        :title="t('account.feedbackImageZoom')"
                        @click="lightbox = url"
                      >
                        <img
                          class="nm-fb__shot-img"
                          :src="url"
                          :alt="uploadFiles[index]?.name || ''"
                        />
                      </button>
                      <div class="nm-fb__shot-meta">
                        <span class="nm-fb__shot-name" :title="uploadFiles[index]?.name">
                          {{ uploadFiles[index]?.name || t('account.feedbackImages') }}
                        </span>
                        <span class="nm-fb__shot-size">
                          {{ formatFileSize(uploadFiles[index]?.size || 0) }}
                        </span>
                      </div>
                      <RsButton
                        class="nm-fb__shot-remove"
                        size="sm"
                        variant="ghost"
                        icon-only
                        :aria-label="t('account.feedbackImageRemove')"
                        @click="removeUploadAt(index)"
                      >
                        <RsIcon name="x" :size="14" />
                      </RsButton>
                    </li>
                  </ul>
                  <RsUpload
                    v-model="uploadFiles"
                    class="nm-fb__uploader"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    :max-count="MAX_IMAGES"
                    :max-size="MAX_FILE_BYTES"
                    :label="
                      hasUploads ? t('account.feedbackDropContinue') : t('account.feedbackDropTitle')
                    "
                    :hint="uploadHint"
                    @reject="onUploadReject"
                  />
                </div>
              </div>

              <p v-if="fbError" class="nm-fb__error" role="alert">{{ fbError }}</p>
              <p v-if="fbDone" class="nm-fb__ok">{{ t('account.feedbackDone') }}</p>
            </div>
          </template>

          <template #mine>
            <div class="nm-fb__pane">
              <div class="nm-fb__mine-head">
                <span class="nm-fb__lead">{{ t('account.feedbackMineIntro') }}</span>
                <RsButton size="sm" variant="ghost" :disabled="fbMineBusy" @click="loadMyFeedback">
                  {{ t('account.feedbackRefresh') }}
                </RsButton>
              </div>

              <RsLoading v-if="fbMineBusy" block :label="t('account.feedbackMineLoading')" show-label />
              <p v-else-if="fbMineError" class="nm-fb__error">{{ fbMineError }}</p>
              <RsEmpty
                v-else-if="!fbMine.length"
                fill
                :description="t('account.feedbackMineEmpty')"
              >
                <template #icon>
                  <RsIcon name="message-square" :size="22" />
                </template>
              </RsEmpty>
              <ul v-else class="nm-fb__list">
                <li v-for="item in fbMine" :key="item.id">
                  <RsCard variant="outlined" radius="md">
                    <div class="nm-fb__card">
                      <div class="nm-fb__card-top">
                        <RsBadge variant="primary">{{ catLabel(item.category) }}</RsBadge>
                        <RsBadge :variant="statusVariant(item.status)">
                          {{ statusLabel(item.status) }}
                        </RsBadge>
                        <span class="nm-fb__meta">{{ formatTime(item.createdAt) }}</span>
                      </div>
                      <h3 class="nm-fb__card-title">{{ item.title }}</h3>
                      <p class="nm-fb__card-body">{{ item.body }}</p>
                      <ul v-if="item.attachments?.length" class="nm-fb__gallery nm-fb__gallery--mine">
                        <li v-for="att in item.attachments" :key="att.id" class="nm-fb__shot">
                          <button
                            type="button"
                            class="nm-fb__shot-preview"
                            :title="att.name"
                            @click="lightbox = attPreview[attKey(item.id, att)] || null"
                          >
                            <img
                              v-if="attPreview[attKey(item.id, att)]"
                              class="nm-fb__shot-img"
                              :src="attPreview[attKey(item.id, att)]"
                              :alt="att.name"
                            />
                            <span v-else class="nm-fb__shot-ph">{{ att.name }}</span>
                          </button>
                          <div class="nm-fb__shot-meta">
                            <span class="nm-fb__shot-name" :title="att.name">{{ att.name }}</span>
                            <span class="nm-fb__shot-size">{{ formatFileSize(att.size) }}</span>
                          </div>
                        </li>
                      </ul>
                      <div v-if="item.staffReply" class="nm-fb__reply">
                        <div class="nm-fb__reply-label">{{ t('account.feedbackReply') }}</div>
                        <p>{{ item.staffReply }}</p>
                        <div v-if="item.staffReplyAt" class="nm-fb__meta">
                          {{ formatTime(item.staffReplyAt) }}
                        </div>
                      </div>
                      <p v-else class="nm-fb__lead">{{ t('account.feedbackNoReply') }}</p>
                    </div>
                  </RsCard>
                </li>
              </ul>
            </div>
          </template>
        </RsTabs>
      </div>

      <div v-if="lightbox" class="nm-fb__lightbox" @click="lightbox = null">
        <img :src="lightbox" alt="" @click.stop />
      </div>
    </template>
    <template #footer>
      <RsButton variant="ghost" :disabled="fbBusy" @click="account.closeFeedback()">
        {{ t('common.cancel') }}
      </RsButton>
      <RsButton
        v-if="fbTab === 'new'"
        variant="primary"
        :loading="fbBusy"
        :disabled="!canSubmit"
        @click="onFeedbackSubmit"
      >
        {{ t('account.feedbackSubmit') }}
      </RsButton>
    </template>
  </RsDialog>
  </div>
</template>

<style scoped>
/* 外层 dialog body 不滚动，只让内容 pane 滚，避免双滚动条 */
.nm-fb-shell :deep(.rs-dialog__body) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-fb-shell :deep(.rs-dialog__content--window) {
  min-height: min(36rem, 80vh);
}

.nm-fb {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  color: var(--rs-text);
}

.nm-fb__tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.nm-fb__tabs :deep(.rs-tabs__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.nm-fb__tabs :deep(.rs-tabs__nav) {
  flex-shrink: 0;
}

/* 面板吃满剩余高度，切换 Tab 不跳；内部 pane 才是唯一滚动区 */
.nm-fb__tabs :deep(.rs-tabs__panel) {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  overflow: hidden;
}

.nm-fb__tabs :deep(.rs-tabs__panel-inner) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-fb__pane {
  display: grid;
  align-content: start;
  gap: var(--rs-space-md, 0.75rem);
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 0.1rem;
}

.nm-fb__lead {
  margin: 0;
  font-size: var(--rs-font-size-sm, 0.8rem);
  line-height: 1.5;
  color: var(--rs-muted);
}

.nm-fb__cats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm, 0.4rem);
}

.nm-fb__field {
  display: grid;
  gap: var(--rs-space-xs, 0.35rem);
  min-width: 0;
}

.nm-fb__textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 7.5rem;
  resize: vertical;
  border-radius: var(--rs-radius, 0.5rem);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
  color: var(--rs-text);
  padding: 0.65rem 0.75rem;
  font: inherit;
  font-size: var(--rs-font-size-sm, 0.875rem);
  line-height: 1.5;
}

.nm-fb__textarea:focus {
  outline: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-fb__media {
  display: grid;
  gap: var(--rs-space-md, 0.75rem);
  min-width: 0;
}

.nm-fb__gallery {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: var(--rs-space-md, 0.75rem);
}

.nm-fb__gallery--mine {
  margin-top: 0.15rem;
}

.nm-fb__shot {
  position: relative;
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.45rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius, 0.55rem);
  background: var(--rs-surface);
  box-shadow: var(--rs-shadow-sm, none);
}

.nm-fb__shot-preview {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 10;
  margin: 0;
  padding: 0.35rem;
  border: none;
  border-radius: calc(var(--rs-radius, 0.5rem) - 2px);
  background: color-mix(in srgb, var(--rs-bg) 70%, var(--rs-surface));
  cursor: zoom-in;
  overflow: hidden;
}

.nm-fb__shot-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.nm-fb__shot-ph {
  font-size: var(--rs-font-size-xs, 0.7rem);
  color: var(--rs-muted);
  text-align: center;
  padding: 0.35rem;
  overflow-wrap: anywhere;
}

.nm-fb__shot-meta {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
  padding: 0 0.1rem 0.1rem;
}

.nm-fb__shot-name {
  overflow: hidden;
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs, 0.75rem);
  font-weight: 550;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-fb__shot-size {
  color: var(--rs-muted);
  font-size: 0.68rem;
  line-height: 1.2;
}

.nm-fb__shot-remove {
  position: absolute !important;
  top: 0.35rem;
  right: 0.35rem;
  z-index: 1;
  width: 1.6rem !important;
  height: 1.6rem !important;
  min-width: 0 !important;
  border-radius: var(--rs-radius-full, 999px) !important;
  background: color-mix(in srgb, var(--rs-surface) 88%, transparent) !important;
  border: 1px solid var(--rs-border) !important;
  color: var(--rs-text) !important;
  box-shadow: var(--rs-shadow-sm, 0 1px 2px rgb(0 0 0 / 0.12));
}

.nm-fb__shot-remove:hover {
  background: var(--rs-surface) !important;
  color: var(--rs-danger) !important;
}

.nm-fb__error {
  margin: 0;
  font-size: var(--rs-font-size-sm, 0.82rem);
  color: var(--rs-danger);
}

.nm-fb__ok {
  margin: 0;
  font-size: var(--rs-font-size-sm, 0.82rem);
  color: var(--rs-success);
}

.nm-fb__mine-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md, 0.75rem);
}

.nm-fb__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--rs-space-md, 0.75rem);
}

.nm-fb__card {
  display: grid;
  gap: var(--rs-space-sm, 0.4rem);
}

.nm-fb__card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
}

.nm-fb__meta {
  margin-left: auto;
  font-size: var(--rs-font-size-xs, 0.72rem);
  color: var(--rs-muted);
}

.nm-fb__card-title {
  margin: 0;
  font-size: var(--rs-font-size-md, 0.95rem);
  font-weight: 650;
  color: var(--rs-text);
}

.nm-fb__card-body {
  margin: 0;
  font-size: var(--rs-font-size-sm, 0.85rem);
  color: var(--rs-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.nm-fb__reply {
  margin-top: 0.15rem;
  padding: 0.6rem 0.7rem;
  border-radius: var(--rs-radius, 0.5rem);
  background: color-mix(in srgb, var(--rs-primary) 11%, var(--rs-surface));
  display: grid;
  gap: 0.25rem;
}

.nm-fb__reply-label {
  font-size: var(--rs-font-size-xs, 0.76rem);
  font-weight: 650;
  color: var(--rs-primary);
}

.nm-fb__reply p {
  margin: 0;
  font-size: var(--rs-font-size-sm, 0.88rem);
  color: var(--rs-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nm-fb__lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgb(0 0 0 / 0.72);
  display: grid;
  place-items: center;
  padding: 1.5rem;
  cursor: zoom-out;
}

.nm-fb__lightbox img {
  max-width: min(92vw, 56rem);
  max-height: 88vh;
  border-radius: var(--rs-radius, 0.4rem);
  box-shadow: var(--rs-shadow-lg, 0 18px 48px rgb(0 0 0 / 0.35));
}

/* 有图时：预览在上，上传区收成紧凑条，避免裁切与重复列表 */
.nm-fb__uploader :deep(.rs-upload__list) {
  display: none;
}

.nm-fb__uploader :deep(.rs-upload__dropzone) {
  min-height: 6.5rem;
  padding: var(--rs-space-lg, 0.9rem);
}

.nm-fb__media--filled .nm-fb__uploader :deep(.rs-upload__dropzone) {
  min-height: 3.25rem;
  flex-direction: row;
  justify-content: flex-start;
  gap: var(--rs-space-md, 0.75rem);
  padding: 0.65rem 0.85rem;
  text-align: left;
}

.nm-fb__media--filled .nm-fb__uploader :deep(.rs-upload__icon) {
  width: 2.1rem;
  height: 2.1rem;
}

.nm-fb__media--filled .nm-fb__uploader :deep(.rs-upload__text) {
  max-width: none;
}
</style>
