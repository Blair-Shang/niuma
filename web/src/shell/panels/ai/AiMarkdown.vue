<script setup lang="ts">
/**
 * AI Markdown：分块渲染 + 高亮/复制/公式注水；图表等重块仅在非流式挂载。
 */
import { copyTextToClipboard } from '@niuma/ui'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isBridgeAvailable } from '@/api/client'
import { shellApi } from '@/api/shell'
import { useTabStore } from '@/stores/tab'
import AiMediaLightbox from './AiMediaLightbox.vue'
import { hydrateMathInElement, renderAiMarkdown, stabilizeStreamingMarkdown } from './markdown'
import { splitMarkdownBlocks, type AiMarkdownBlock } from './split-markdown-blocks'

const AiChartBlock = defineAsyncComponent(() => import('./AiChartBlock.vue'))
const AiMermaidBlock = defineAsyncComponent(() => import('./AiMermaidBlock.vue'))
const AiMathBlock = defineAsyncComponent(() => import('./AiMathBlock.vue'))
const AiMetaCard = defineAsyncComponent(() => import('./AiMetaCard.vue'))
const AiToolCallCard = defineAsyncComponent(() => import('./AiToolCallCard.vue'))
const AiResultCard = defineAsyncComponent(() => import('./AiResultCard.vue'))
const AiJsonTree = defineAsyncComponent(() => import('./AiJsonTree.vue'))

const props = withDefaults(
  defineProps<{
    source: string
    /** 流式：防抖 + 围栏稳定；图表/公式块延迟挂载。 */
    streaming?: boolean
    /** 轻量模式：跳过图表等重块（用于 thinking）。 */
    lite?: boolean
  }>(),
  {
    streaming: false,
    lite: false,
  },
)

const { t } = useI18n()
const tabStore = useTabStore()
const rootEl = ref<HTMLElement | null>(null)
const previewOpen = ref(false)
const previewSrc = ref<string | null>(null)

type ViewBlock =
  | { key: string; kind: 'html'; html: string }
  | { key: string; kind: 'echarts'; text: string }
  | { key: string; kind: 'mermaid'; text: string }
  | { key: string; kind: 'math'; text: string }
  | { key: string; kind: 'ref'; text: string }
  | { key: string; kind: 'tool'; text: string }
  | { key: string; kind: 'result'; text: string }
  | { key: string; kind: 'json-tree'; text: string }

const viewBlocks = ref<ViewBlock[]>([])

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let hydrateSeq = 0

const heavyActive = computed(() => !props.streaming)

function applyCopyLabels(root: HTMLElement): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-nm-ai-copy]')) {
    const idle = btn.querySelector<HTMLElement>('.nm-ai-md__copy-idle')
    const done = btn.querySelector<HTMLElement>('.nm-ai-md__copy-done')
    if (idle) {
      idle.textContent = t('ai.copyCode')
    }
    if (done) {
      done.textContent = t('ai.copiedCode')
    }
    btn.setAttribute('aria-label', t('ai.copyCode'))
    btn.title = t('ai.copyCode')
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-nm-ai-expand]')) {
    const block = btn.closest('.nm-ai-md__codeblock')
    const expanded = block?.classList.contains('is-expanded')
    const label = expanded ? t('ai.collapseCode') : t('ai.expandCode')
    btn.setAttribute('aria-label', label)
    btn.title = label
    if (btn.classList.contains('nm-ai-md__code-more')) {
      btn.textContent = expanded ? t('ai.collapseCode') : t('ai.expandCode')
    }
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-nm-ai-wrap]')) {
    const block = btn.closest('.nm-ai-md__codeblock')
    const wrapped = block?.classList.contains('is-wrap') ?? false
    btn.textContent = t('ai.wrapCode')
    btn.title = t('ai.wrapCode')
    btn.setAttribute('aria-pressed', wrapped ? 'true' : 'false')
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-nm-ai-open]')) {
    btn.textContent = t('ai.openInEditor')
    btn.title = t('ai.openInEditor')
  }
}

function bindBrokenImages(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('[data-nm-ai-img]')) {
    if (img.dataset.nmAiImgBound === '1') {
      continue
    }
    img.dataset.nmAiImgBound = '1'
    img.addEventListener('error', () => {
      img.classList.add('is-broken')
      const wrap = img.closest('.nm-ai-md__img-wrap')
      if (wrap && !wrap.querySelector('.nm-ai-md__img-fallback')) {
        const fb = document.createElement('span')
        fb.className = 'nm-ai-md__img-fallback'
        fb.textContent = t('ai.imageFailed')
        wrap.appendChild(fb)
      }
    })
  }
}

function toViewBlocks(blocks: AiMarkdownBlock[], streaming: boolean, lite: boolean): ViewBlock[] {
  const out: ViewBlock[] = []
  let i = 0
  for (const b of blocks) {
    const key = `${b.kind}-${i}`
    i += 1
    if (b.kind === 'markdown') {
      out.push({
        key,
        kind: 'html',
        html: renderAiMarkdown(b.text, {
          streaming,
          skipMathExtract: streaming,
        }),
      })
      continue
    }
    if (lite) {
      // thinking 轻量：特殊块降级为代码展示
      const fence =
        b.kind === 'math'
          ? `\`\`\`latex\n${b.text}\n\`\`\``
          : `\`\`\`${b.kind}\n${b.text}\n\`\`\``
      out.push({
        key,
        kind: 'html',
        html: renderAiMarkdown(fence, { streaming, skipMathExtract: true }),
      })
      continue
    }
    if (b.kind === 'echarts') {
      out.push({ key, kind: 'echarts', text: b.text })
    } else if (b.kind === 'mermaid') {
      out.push({ key, kind: 'mermaid', text: b.text })
    } else if (b.kind === 'math') {
      out.push({ key, kind: 'math', text: b.text })
    } else if (b.kind === 'ref') {
      out.push({ key, kind: 'ref', text: b.text })
    } else if (b.kind === 'tool') {
      out.push({ key, kind: 'tool', text: b.text })
    } else if (b.kind === 'result') {
      out.push({ key, kind: 'result', text: b.text })
    } else if (b.kind === 'json-tree') {
      out.push({ key, kind: 'json-tree', text: b.text })
    }
  }
  return out
}

async function afterRender(): Promise<void> {
  await nextTick()
  const root = rootEl.value
  if (!root) {
    return
  }
  applyCopyLabels(root)
  bindBrokenImages(root)
  if (!props.streaming) {
    const seq = ++hydrateSeq
    await hydrateMathInElement(root)
    if (seq !== hydrateSeq) {
      return
    }
  }
}

function scheduleRender(source: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const delay = props.streaming ? 48 : 0
  const run = () => {
    const stabilized = props.streaming ? stabilizeStreamingMarkdown(source) : source
    const blocks = splitMarkdownBlocks(stabilized)
    viewBlocks.value = toViewBlocks(blocks, props.streaming, props.lite)
    void afterRender()
  }
  if (delay <= 0) {
    run()
    return
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    run()
  }, delay)
}

watch(
  () => [props.source, props.streaming, props.lite] as const,
  ([source]) => {
    scheduleRender(source)
  },
  { immediate: true },
)

async function openExternalHref(href: string): Promise<void> {
  if (isBridgeAvailable()) {
    await shellApi.openExternal({ url: href }).catch(() => {
      window.open(href, '_blank', 'noopener,noreferrer')
    })
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

async function onClick(e: MouseEvent): Promise<void> {
  const target = e.target
  if (!(target instanceof Element) || !rootEl.value) {
    return
  }
  // 图片：应用内预览，禁止 CEF 对 data:/http 开 Popup（易黑屏）
  const img = target.closest<HTMLImageElement>('[data-nm-ai-img]')
  if (img && rootEl.value.contains(img) && img.src && !img.classList.contains('is-broken')) {
    e.preventDefault()
    previewSrc.value = img.src
    previewOpen.value = true
    return
  }
  // 外链：系统浏览器打开，避免 CEF Popup 黑屏
  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  if (anchor && rootEl.value.contains(anchor)) {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      await openExternalHref(href)
      return
    }
  }
  const expand = target.closest<HTMLButtonElement>('[data-nm-ai-expand]')
  if (expand && rootEl.value.contains(expand)) {
    e.preventDefault()
    const block = expand.closest('.nm-ai-md__codeblock')
    if (block) {
      block.classList.toggle('is-expanded')
      block.classList.toggle('is-collapsed')
      applyCopyLabels(rootEl.value)
    }
    return
  }
  const wrapBtn = target.closest<HTMLButtonElement>('[data-nm-ai-wrap]')
  if (wrapBtn && rootEl.value.contains(wrapBtn)) {
    e.preventDefault()
    wrapBtn.closest('.nm-ai-md__codeblock')?.classList.toggle('is-wrap')
    applyCopyLabels(rootEl.value)
    return
  }
  const openBtn = target.closest<HTMLButtonElement>('[data-nm-ai-open]')
  if (openBtn && rootEl.value.contains(openBtn)) {
    e.preventDefault()
    const block = openBtn.closest('.nm-ai-md__codeblock')
    const code = block?.querySelector('code')?.textContent ?? ''
    const active = tabStore.activeTab
    const profileId = typeof active?.props.profileId === 'string' ? active.props.profileId : undefined
    if (profileId) {
      tabStore.openTab({
        moduleId: active?.moduleId || 'vastbase',
        title: active?.title,
        props: {
          ...active?.props,
          profileId,
          initialTab: 'query',
          initialSql: code,
        },
      })
    } else {
      await copyTextToClipboard(code)
    }
    return
  }
  const btn = target.closest<HTMLButtonElement>('[data-nm-ai-copy]')
  if (!btn || !rootEl.value.contains(btn)) {
    return
  }
  e.preventDefault()
  const block = btn.closest('.nm-ai-md__codeblock')
  const code = block?.querySelector('code')?.textContent ?? ''
  const ok = await copyTextToClipboard(code)
  const idle = btn.querySelector<HTMLElement>('.nm-ai-md__copy-idle')
  const done = btn.querySelector<HTMLElement>('.nm-ai-md__copy-done')
  if (!ok) {
    btn.title = t('ai.copyCodeFailed')
    return
  }
  if (idle) {
    idle.hidden = true
  }
  if (done) {
    done.hidden = false
  }
  btn.title = t('ai.copiedCode')
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
  copiedTimer = setTimeout(() => {
    if (idle) {
      idle.hidden = false
    }
    if (done) {
      done.hidden = true
    }
    btn.title = t('ai.copyCode')
  }, 1600)
}

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
  hydrateSeq += 1
})

const hasContent = computed(() => viewBlocks.value.length > 0)
</script>

<template>
  <div v-show="hasContent" ref="rootEl" class="nm-ai-md" @click="onClick">
    <template v-for="block in viewBlocks" :key="block.key">
      <div v-if="block.kind === 'html'" class="nm-ai-md__chunk" v-html="block.html" />
      <AiChartBlock
        v-else-if="block.kind === 'echarts'"
        :source="block.text"
        :active="heavyActive"
      />
      <AiMermaidBlock
        v-else-if="block.kind === 'mermaid'"
        :source="block.text"
        :active="heavyActive"
      />
      <AiMathBlock
        v-else-if="block.kind === 'math'"
        :source="block.text"
        :active="heavyActive"
      />
      <AiToolCallCard
        v-else-if="block.kind === 'tool'"
        :source="block.text"
      />
      <AiMetaCard
        v-else-if="block.kind === 'ref'"
        kind="ref"
        :source="block.text"
      />
      <AiResultCard
        v-else-if="block.kind === 'result'"
        :source="block.text"
      />
      <AiJsonTree
        v-else-if="block.kind === 'json-tree'"
        :source="block.text"
      />
    </template>
    <AiMediaLightbox v-model:open="previewOpen" :image-src="previewSrc" />
  </div>
</template>

<style scoped>
.nm-ai-md {
  font-size: 13px;
  line-height: 1.65;
  letter-spacing: -0.011em;
  color: var(--rs-text);
  overflow-wrap: anywhere;
}

.nm-ai-md__chunk :deep(> :first-child) {
  margin-top: 0;
}

.nm-ai-md__chunk :deep(> :last-child) {
  margin-bottom: 0;
}

.nm-ai-md :deep(p),
.nm-ai-md :deep(ul),
.nm-ai-md :deep(ol),
.nm-ai-md :deep(blockquote),
.nm-ai-md :deep(pre),
.nm-ai-md :deep(.nm-ai-md__codeblock),
.nm-ai-md :deep(.nm-ai-md__table-wrap),
.nm-ai-md :deep(hr) {
  margin: 0.65em 0;
}

.nm-ai-md :deep(h1),
.nm-ai-md :deep(h2),
.nm-ai-md :deep(h3),
.nm-ai-md :deep(h4) {
  margin: 1em 0 0.45em;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.35;
  color: var(--rs-text);
}

.nm-ai-md :deep(h1) {
  font-size: 1.2em;
}

.nm-ai-md :deep(h2) {
  font-size: 1.1em;
}

.nm-ai-md :deep(h3),
.nm-ai-md :deep(h4) {
  font-size: 1.02em;
}

.nm-ai-md :deep(a) {
  color: color-mix(in srgb, var(--nm-aurora-a) 70%, var(--rs-text));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.nm-ai-md :deep(strong) {
  font-weight: 650;
}

.nm-ai-md :deep(em) {
  font-style: italic;
}

/* Tailwind preflight 会 list-style:none；此处必须显式恢复 */
.nm-ai-md :deep(ul) {
  list-style: disc outside;
  padding-inline-start: 1.6em;
}

.nm-ai-md :deep(ol) {
  list-style: decimal outside;
  padding-inline-start: 1.85em;
}

.nm-ai-md :deep(ul ul) {
  list-style-type: circle;
}

.nm-ai-md :deep(ol ol) {
  list-style-type: lower-alpha;
}

.nm-ai-md :deep(li) {
  margin: 0.2em 0;
  padding-inline-start: 0.15em;
}

.nm-ai-md :deep(li::marker) {
  color: color-mix(in srgb, var(--rs-muted) 92%, var(--rs-text));
  font-variant-numeric: tabular-nums;
}

.nm-ai-md :deep(li > p) {
  margin: 0.25em 0;
}

.nm-ai-md :deep(ul:has(input[type='checkbox'])) {
  list-style: none;
  padding-inline-start: 0.15em;
}

.nm-ai-md :deep(li:has(> input[type='checkbox'])) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.nm-ai-md :deep(input[type='checkbox']) {
  margin: 0.35em 0 0;
  accent-color: color-mix(in srgb, var(--nm-aurora-a) 80%, var(--rs-text));
  pointer-events: none;
}

.nm-ai-md :deep(blockquote) {
  padding: 0.15em 0 0.15em 0.85em;
  border-left: 3px solid color-mix(in srgb, var(--rs-text) 18%, transparent);
  color: var(--rs-muted);
}

.nm-ai-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}

.nm-ai-md :deep(:not(pre) > code) {
  padding: 0.12em 0.38em;
  border-radius: 5px;
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__codeblock) {
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 88%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__code-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 4px 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__code-lang) {
  font-size: 11px;
  font-weight: 500;
  color: var(--rs-muted);
  text-transform: lowercase;
}

.nm-ai-md :deep(.nm-ai-md__code-actions) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.nm-ai-md :deep(.nm-ai-md__copy),
.nm-ai-md :deep(.nm-ai-md__code-wrap),
.nm-ai-md :deep(.nm-ai-md__code-open),
.nm-ai-md :deep(.nm-ai-md__code-expand),
.nm-ai-md :deep(.nm-ai-md__code-more) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.nm-ai-md :deep(.nm-ai-md__copy:hover),
.nm-ai-md :deep(.nm-ai-md__code-wrap:hover),
.nm-ai-md :deep(.nm-ai-md__code-open:hover),
.nm-ai-md :deep(.nm-ai-md__code-expand:hover),
.nm-ai-md :deep(.nm-ai-md__code-more:hover) {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-wrap .nm-ai-md__code-wrap) {
  background: color-mix(in srgb, var(--rs-text) 10%, transparent);
  color: var(--rs-text);
}

.nm-ai-md :deep(.nm-ai-md__code-more) {
  display: none;
  width: 100%;
  min-height: 28px;
  border-top: 1px solid var(--rs-border-subtle);
  border-radius: 0;
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-collapsed .nm-ai-md__code-more) {
  display: inline-flex;
}

/* 高度约束打在 code-body 上，避免 gutter 行号把收起态撑出大片空白占位 */
.nm-ai-md :deep(.nm-ai-md__code-body) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  max-height: 22rem;
  overflow: auto;
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-collapsed .nm-ai-md__code-body) {
  max-height: 14rem;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-expanded .nm-ai-md__code-body) {
  max-height: none;
  overflow: visible;
  mask-image: none;
}

.nm-ai-md :deep(.nm-ai-md__gutter) {
  display: flex;
  flex-direction: column;
  padding: 10px 0 10px 8px;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2.5%, transparent);
  user-select: none;
}

.nm-ai-md :deep(.nm-ai-md__ln) {
  display: block;
  min-width: 1.6em;
  padding-right: 8px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  text-align: right;
  color: color-mix(in srgb, var(--rs-muted) 80%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-wrap .nm-ai-md__gutter) {
  display: none;
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-wrap .nm-ai-md__code-body) {
  grid-template-columns: minmax(0, 1fr);
}

.nm-ai-md :deep(.nm-ai-md__codeblock.is-wrap .nm-ai-md__pre code) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nm-ai-md :deep(.nm-ai-md__pre) {
  margin: 0;
  padding: 10px 12px;
  overflow: visible;
  min-width: 0;
}

.nm-ai-md :deep(.nm-ai-md__pre code.hljs) {
  display: block;
  padding: 0;
  background: transparent;
  font-size: 12px;
  line-height: 1.55;
  color: var(--rs-text);
  white-space: pre;
}

.nm-ai-md :deep(.hljs-comment),
.nm-ai-md :deep(.hljs-quote) {
  color: color-mix(in srgb, var(--rs-muted) 88%, #8b9cb3);
  font-style: italic;
}

.nm-ai-md :deep(.hljs-keyword),
.nm-ai-md :deep(.hljs-selector-tag),
.nm-ai-md :deep(.hljs-section),
.nm-ai-md :deep(.hljs-link) {
  color: color-mix(in srgb, var(--nm-aurora-a) 55%, #c792ea);
}

.nm-ai-md :deep(.hljs-string),
.nm-ai-md :deep(.hljs-doctag),
.nm-ai-md :deep(.hljs-template-tag) {
  color: color-mix(in srgb, var(--nm-aurora-e, #34d399) 70%, #c3e88d);
}

.nm-ai-md :deep(.hljs-number),
.nm-ai-md :deep(.hljs-literal),
.nm-ai-md :deep(.hljs-bullet) {
  color: #f78c6c;
}

.nm-ai-md :deep(.hljs-title),
.nm-ai-md :deep(.hljs-title.function_),
.nm-ai-md :deep(.hljs-name) {
  color: #82aaff;
}

.nm-ai-md :deep(.hljs-attr),
.nm-ai-md :deep(.hljs-attribute),
.nm-ai-md :deep(.hljs-variable),
.nm-ai-md :deep(.hljs-template-variable),
.nm-ai-md :deep(.hljs-type),
.nm-ai-md :deep(.hljs-built_in),
.nm-ai-md :deep(.hljs-selector-class) {
  color: #ffcb6b;
}

.nm-ai-md :deep(.hljs-meta),
.nm-ai-md :deep(.hljs-symbol) {
  color: #89ddff;
}

.nm-ai-md :deep(.hljs-deletion) {
  color: #f07178;
  background: color-mix(in srgb, #f07178 12%, transparent);
}

.nm-ai-md :deep(.hljs-addition) {
  color: #c3e88d;
  background: color-mix(in srgb, #c3e88d 12%, transparent);
}

[data-rs-theme='light'] .nm-ai-md :deep(.hljs-keyword),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-selector-tag) {
  color: #7c3aed;
}

[data-rs-theme='light'] .nm-ai-md :deep(.hljs-string),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-doctag) {
  color: #057a55;
}

[data-rs-theme='light'] .nm-ai-md :deep(.hljs-number),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-literal) {
  color: #c2410c;
}

[data-rs-theme='light'] .nm-ai-md :deep(.hljs-title),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-name) {
  color: #1d4ed8;
}

[data-rs-theme='light'] .nm-ai-md :deep(.hljs-attr),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-variable),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-type),
[data-rs-theme='light'] .nm-ai-md :deep(.hljs-built_in) {
  color: #b45309;
}

.nm-ai-md :deep(.nm-ai-md__table-wrap) {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--rs-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--nm-elevated-bg) 60%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__table-wrap table) {
  width: 100%;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 0;
}

.nm-ai-md :deep(th),
.nm-ai-md :deep(td) {
  padding: 7px 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
  border-right: 1px solid var(--rs-border-subtle);
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}

.nm-ai-md :deep(th:last-child),
.nm-ai-md :deep(td:last-child) {
  border-right: none;
}

.nm-ai-md :deep(tr:last-child td) {
  border-bottom: none;
}

.nm-ai-md :deep(th) {
  position: sticky;
  top: 0;
  font-weight: 600;
  background: color-mix(in srgb, var(--rs-text) 6%, var(--nm-elevated-bg));
  color: var(--rs-text);
}

.nm-ai-md :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--rs-text) 2.5%, transparent);
}

.nm-ai-md :deep(.nm-ai-md__img-wrap) {
  display: block;
  margin: 0.65em 0;
}

.nm-ai-md :deep(.nm-ai-md__img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  border: 1px solid var(--rs-border-subtle);
  cursor: zoom-in;
}

.nm-ai-md :deep(.nm-ai-md__img.is-broken) {
  display: none;
}

.nm-ai-md :deep(.nm-ai-md__img-fallback) {
  display: inline-block;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--rs-border-subtle);
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-ai-md :deep(.nm-ai-md__math) {
  color: var(--rs-text);
}

.nm-ai-md :deep(.nm-ai-md__math[data-nm-ai-math='display']) {
  display: block;
  margin: 0.75em 0;
  overflow-x: auto;
  text-align: center;
}

.nm-ai-md :deep(section.footnotes) {
  margin-top: 1em;
  padding-top: 0.5em;
  border-top: 1px solid var(--rs-border-subtle);
  font-size: 12px;
  color: var(--rs-muted);
}
</style>
