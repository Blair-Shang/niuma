<script setup lang="ts">
/**
 * Mermaid 图：动态 import；支持缩放 / 复位 / 复制源码与 SVG。
 */
import { copyTextToClipboard, RsIcon } from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  source: string
  active: boolean
}>()

const { t } = useI18n()
const host = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const error = ref<string | null>(null)
const pending = ref(false)
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const copiedHint = ref<'source' | 'svg' | null>(null)
const panning = ref(false)

const MIN_SCALE = 0.4
const MAX_SCALE = 3
const SCALE_STEP = 0.15

let renderSeq = 0
let mermaidMod: typeof import('mermaid') | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0

const transformStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
}))

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`)

async function getMermaid() {
  if (!mermaidMod) {
    mermaidMod = await import('mermaid')
    mermaidMod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.getAttribute('data-rs-theme') === 'light' ? 'default' : 'dark',
    })
  }
  return mermaidMod.default
}

function resetView(): void {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function zoomIn(): void {
  scale.value = Math.min(MAX_SCALE, Number((scale.value + SCALE_STEP).toFixed(2)))
}

function zoomOut(): void {
  scale.value = Math.max(MIN_SCALE, Number((scale.value - SCALE_STEP).toFixed(2)))
}

function onWheel(e: WheelEvent): void {
  if (!props.active || error.value) {
    return
  }
  // Ctrl/Meta + 滚轮缩放；否则交给外层滚动
  if (!(e.ctrlKey || e.metaKey)) {
    return
  }
  e.preventDefault()
  if (e.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || scale.value <= 1.01) {
    return
  }
  const el = viewport.value
  if (!el) {
    return
  }
  panning.value = true
  panStartX = e.clientX
  panStartY = e.clientY
  panOriginX = offsetX.value
  panOriginY = offsetY.value
  el.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!panning.value) {
    return
  }
  offsetX.value = panOriginX + (e.clientX - panStartX)
  offsetY.value = panOriginY + (e.clientY - panStartY)
}

function onPointerUp(e: PointerEvent): void {
  if (!panning.value) {
    return
  }
  panning.value = false
  viewport.value?.releasePointerCapture(e.pointerId)
}

function flashCopied(kind: 'source' | 'svg'): void {
  copiedHint.value = kind
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
  copiedTimer = setTimeout(() => {
    copiedHint.value = null
  }, 1400)
}

async function copySource(): Promise<void> {
  if (await copyTextToClipboard(props.source.trim())) {
    flashCopied('source')
  }
}

async function copySvg(): Promise<void> {
  const svg = host.value?.querySelector('svg')?.outerHTML ?? ''
  if (!svg) {
    return
  }
  if (await copyTextToClipboard(svg)) {
    flashCopied('svg')
  }
}

async function render(): Promise<void> {
  const seq = ++renderSeq
  error.value = null
  resetView()
  if (!props.active) {
    pending.value = true
    if (host.value) {
      host.value.innerHTML = ''
    }
    return
  }
  pending.value = false
  await nextTick()
  const el = host.value
  if (!el) {
    return
  }
  const text = props.source.trim()
  if (!text) {
    el.innerHTML = ''
    return
  }
  try {
    const mermaid = await getMermaid()
    if (seq !== renderSeq) {
      return
    }
    const id = `nm-ai-mmd-${seq}-${Math.random().toString(36).slice(2, 8)}`
    const { svg } = await mermaid.render(id, text)
    if (seq !== renderSeq) {
      return
    }
    el.innerHTML = svg
  } catch (e) {
    if (seq !== renderSeq) {
      return
    }
    error.value = e instanceof Error ? e.message : String(e)
    el.innerHTML = ''
  }
}

watch(
  () => [props.active, props.source] as const,
  () => {
    void render()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  renderSeq += 1
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
})
</script>

<template>
  <div class="nm-ai-mermaid">
    <div v-if="!active || pending" class="nm-ai-mermaid__pending">
      {{ t('ai.diagramPending') }}
    </div>
    <div v-else-if="error" class="nm-ai-mermaid__error" role="alert">
      {{ t('ai.diagramInvalid') }}
      <pre class="nm-ai-mermaid__raw">{{ source }}</pre>
    </div>
    <template v-else>
      <div class="nm-ai-mermaid__toolbar">
        <button type="button" class="nm-ai-mermaid__btn" :title="t('ai.diagramZoomOut')" @click="zoomOut">
          <RsIcon name="zoom-out" :size="13" />
        </button>
        <span class="nm-ai-mermaid__scale">{{ scaleLabel }}</span>
        <button type="button" class="nm-ai-mermaid__btn" :title="t('ai.diagramZoomIn')" @click="zoomIn">
          <RsIcon name="zoom-in" :size="13" />
        </button>
        <button type="button" class="nm-ai-mermaid__btn" :title="t('ai.diagramResetZoom')" @click="resetView">
          <RsIcon name="rotate-ccw" :size="13" />
        </button>
        <span class="nm-ai-mermaid__spacer" />
        <button type="button" class="nm-ai-mermaid__btn" :title="t('ai.diagramCopySource')" @click="copySource">
          <RsIcon name="copy" :size="13" />
          <span>{{ copiedHint === 'source' ? t('ai.copiedCode') : t('ai.diagramCopySource') }}</span>
        </button>
        <button type="button" class="nm-ai-mermaid__btn" :title="t('ai.diagramCopySvg')" @click="copySvg">
          <RsIcon name="file-code" :size="13" />
          <span>{{ copiedHint === 'svg' ? t('ai.copiedCode') : t('ai.diagramCopySvg') }}</span>
        </button>
      </div>
      <div
        ref="viewport"
        class="nm-ai-mermaid__viewport"
        :class="{ 'is-panning': panning, 'is-zoomed': scale > 1.01 }"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div ref="host" class="nm-ai-mermaid__host" :style="transformStyle" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.nm-ai-mermaid {
  margin: 0.65em 0;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 80%, transparent);
}

.nm-ai-mermaid__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, transparent);
}

.nm-ai-mermaid__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 0 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-muted);
  font-size: 11px;
  cursor: pointer;
}

.nm-ai-mermaid__btn:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-mermaid__scale {
  min-width: 2.6em;
  text-align: center;
  font-size: 11px;
  color: var(--rs-muted);
  font-variant-numeric: tabular-nums;
}

.nm-ai-mermaid__spacer {
  flex: 1;
}

.nm-ai-mermaid__viewport {
  overflow: hidden;
  max-height: 28rem;
  cursor: default;
  touch-action: none;
}

.nm-ai-mermaid__viewport.is-zoomed {
  cursor: grab;
}

.nm-ai-mermaid__viewport.is-panning {
  cursor: grabbing;
}

.nm-ai-mermaid__host {
  padding: 14px;
  text-align: center;
  transform-origin: center center;
  transition: transform 0.08s ease-out;
  will-change: transform;
}

.nm-ai-mermaid__viewport.is-panning .nm-ai-mermaid__host {
  transition: none;
}

.nm-ai-mermaid__host :deep(svg) {
  max-width: 100%;
  height: auto;
}

.nm-ai-mermaid__pending,
.nm-ai-mermaid__error {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-ai-mermaid__error {
  color: var(--rs-danger);
}

.nm-ai-mermaid__raw {
  margin: 8px 0 0;
  max-height: 8rem;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
  font-size: 11px;
  white-space: pre-wrap;
}
</style>
