<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsPopover } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
import MountProbe from '../components/MountProbe.vue'

const controlledOpen = ref(false)

const widthDemo = ref<'sm' | 'md' | 'lg' | 'auto'>('md')
const widthOpen = ref(false)

const align = ref<'start' | 'center' | 'end'>('start')

const offsetOpen = ref(false)
const sideOffset = ref(6)

const modalOpen = ref(false)

const lazyOpen = ref(false)
const eagerOpen = ref(false)
const forceOpen = ref(false)

const lazyContentMounted = ref(false)
const eagerContentMounted = ref(false)
const forceContentMounted = ref(false)

const lastAction = ref('（未操作）')

const sides = ['top', 'right', 'bottom', 'left'] as const
const aligns = ['start', 'center', 'end'] as const
const widths = ['sm', 'md', 'lg', 'auto'] as const

function mountLabel(mounted: boolean) {
  return mounted ? '已挂载' : '未挂载'
}
</script>

<template>
  <DemoPage title="RsPopover" test-file="RsPopover.spec.ts">
    <DemoBlock title="基础用法">
      <p class="hint">
        默认插槽为触发器，<code>#content</code> 为浮层内容；点击触发器切换显隐，点击外部或按 Esc 关闭。
      </p>
      <RsPopover>
        <RsButton variant="default">打开 Popover</RsButton>
        <template #content>
          <p class="content-text">轻量浮层，适合补充说明、快捷操作或小型表单。</p>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="受控显隐 v-model:open">
      <p class="hint">通过 <code>v-model:open</code> 由外部控制开关，适合与业务状态联动。</p>
      <div class="row">
        <RsButton size="sm" @click="controlledOpen = true">外部打开</RsButton>
        <RsButton size="sm" variant="default" @click="controlledOpen = false">外部关闭</RsButton>
        <span class="value">open = <code>{{ controlledOpen }}</code></span>
      </div>
      <RsPopover v-model:open="controlledOpen">
        <RsButton variant="default">受控触发器</RsButton>
        <template #content>
          <p class="content-text">当前由外部按钮与触发器共同控制显隐。</p>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="宽度预设 width">
      <p class="hint"><code>sm</code> / <code>md</code> / <code>lg</code> / <code>auto</code> 控制内容区宽度。</p>
      <div class="row">
        <RsButton
          v-for="w in widths"
          :key="w"
          size="sm"
          variant="default"
          @click="widthDemo = w; widthOpen = true"
        >
          {{ w }}
        </RsButton>
      </div>
      <RsPopover v-model:open="widthOpen" :width="widthDemo">
        <RsButton variant="default">宽度：{{ widthDemo }}</RsButton>
        <template #content>
          <p class="content-text">
            当前 <code>width="{{ widthDemo }}"</code>，内容区应用
            <code>rs-popover__content--{{ widthDemo }}</code>。
          </p>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="弹出方位 side">
      <p class="hint">在容器四角附近切换 <code>side</code>，观察浮层相对触发器的位置。</p>
      <div class="placement-grid">
        <RsPopover
          v-for="s in sides"
          :key="s"
          :side="s"
          align="center"
        >
          <RsButton size="sm" variant="default">{{ s }}</RsButton>
          <template #content>
            <p class="content-text content-text--compact">side: {{ s }}</p>
          </template>
        </RsPopover>
      </div>
    </DemoBlock>

    <DemoBlock title="对齐方式 align">
      <p class="hint">固定 <code>side="bottom"</code>，切换 <code>align</code> 观察水平对齐。</p>
      <div class="row">
        <RsButton
          v-for="a in aligns"
          :key="a"
          size="sm"
          :variant="align === a ? 'primary' : 'default'"
          @click="align = a"
        >
          {{ a }}
        </RsButton>
      </div>
      <RsPopover side="bottom" :align="align" :side-offset="12">
        <RsButton variant="default">align: {{ align }}</RsButton>
        <template #content>
          <p class="content-text content-text--compact">align: {{ align }}</p>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="间距 sideOffset">
      <p class="hint"><code>side-offset</code> 控制浮层与触发器之间的距离（默认 6px）。</p>
      <div class="row">
        <label class="offset-label">
          offset
          <input v-model.number="sideOffset" type="range" min="0" max="32" step="2" />
          <code>{{ sideOffset }}px</code>
        </label>
        <RsButton size="sm" variant="default" @click="offsetOpen = true">预览</RsButton>
      </div>
      <RsPopover v-model:open="offsetOpen" :side-offset="sideOffset">
        <RsButton variant="default">间距演示</RsButton>
        <template #content>
          <p class="content-text content-text--compact">side-offset: {{ sideOffset }}px</p>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="模态模式 modal">
      <p class="hint">
        <code>modal</code> 为 true 时启用模态行为：焦点陷阱，外部交互受限（适合表单类浮层）。
      </p>
      <RsPopover v-model:open="modalOpen" modal>
        <RsButton @click="modalOpen = true">模态 Popover</RsButton>
        <template #content>
          <p class="content-title">编辑标签</p>
          <input class="demo-input" type="text" placeholder="输入标签名称" />
          <div class="content-actions">
            <RsButton size="sm" variant="default" @click="modalOpen = false">取消</RsButton>
            <RsButton size="sm" @click="modalOpen = false">保存</RsButton>
          </div>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="挂载策略：lazyMount / forceMount">
      <p class="hint">
        默认 <code>lazy-mount</code> 关闭后卸载内容；<code>lazy-mount="false"</code> 或
        <code>force-mount</code> 会通过 Reka <code>Presence</code> 保留 DOM（仅隐藏）。下方状态由内容区
        <code>onMounted</code> / <code>onUnmounted</code> 探测。
      </p>
      <div class="mount-grid">
        <div class="mount-card">
          <p class="mount-card__title">默认 lazyMount</p>
          <p class="mount-card__status">
            内容 DOM：<code>{{ mountLabel(lazyContentMounted) }}</code>
            · open = <code>{{ lazyOpen }}</code>
          </p>
          <RsPopover v-model:open="lazyOpen">
            <RsButton size="sm" variant="default">切换</RsButton>
            <template #content>
              <MountProbe @mount="lazyContentMounted = true" @unmount="lazyContentMounted = false" />
              <p class="content-text content-text--compact">关闭后卸载</p>
            </template>
          </RsPopover>
        </div>

        <div class="mount-card">
          <p class="mount-card__title">lazy-mount="false"</p>
          <p class="mount-card__status">
            内容 DOM：<code>{{ mountLabel(eagerContentMounted) }}</code>
            · open = <code>{{ eagerOpen }}</code>
          </p>
          <RsPopover v-model:open="eagerOpen" :lazy-mount="false">
            <RsButton size="sm" variant="default">切换</RsButton>
            <template #content>
              <MountProbe @mount="eagerContentMounted = true" @unmount="eagerContentMounted = false" />
              <p class="content-text content-text--compact">关闭后仍保留</p>
            </template>
          </RsPopover>
        </div>

        <div class="mount-card">
          <p class="mount-card__title">force-mount</p>
          <p class="mount-card__status">
            内容 DOM：<code>{{ mountLabel(forceContentMounted) }}</code>
            · open = <code>{{ forceOpen }}</code>
          </p>
          <RsPopover v-model:open="forceOpen" force-mount>
            <RsButton size="sm" variant="default">切换</RsButton>
            <template #content>
              <MountProbe @mount="forceContentMounted = true" @unmount="forceContentMounted = false" />
              <p class="content-text content-text--compact">覆盖 lazyMount</p>
            </template>
          </RsPopover>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="场景：用户信息卡片">
      <p class="hint">悬停头像或点击展示成员摘要，适合协作场景中的轻量详情。</p>
      <RsPopover side="bottom" align="start" width="lg">
        <button type="button" class="user-trigger" aria-label="查看用户信息">
          <span class="user-trigger__avatar">RS</span>
          <span class="user-trigger__name">弱水 Studio</span>
        </button>
        <template #content>
          <div class="user-card">
            <div class="user-card__header">
              <span class="user-card__avatar">RS</span>
              <div>
                <p class="user-card__name">弱水 Studio</p>
                <p class="user-card__email">studio@ruoshui.dev</p>
              </div>
            </div>
            <p class="user-card__bio">负责设计系统与组件库维护，偏好 Linear 风暗色界面。</p>
            <div class="content-actions">
              <RsButton size="sm" variant="default">发消息</RsButton>
              <RsButton size="sm">查看资料</RsButton>
            </div>
          </div>
        </template>
      </RsPopover>
    </DemoBlock>

    <DemoBlock title="场景：快捷操作菜单">
      <p class="hint">窄宽浮层承载操作列表，选中后关闭并记录最近操作（非 RsDropdown，适合自定义布局）。</p>
      <RsPopover side="bottom" align="end" width="sm">
        <RsButton variant="ghost" size="sm">⋯</RsButton>
        <template #content>
          <ul class="action-list">
            <li>
              <button type="button" class="action-list__item" @click="lastAction = '复制链接'">
                复制链接
              </button>
            </li>
            <li>
              <button type="button" class="action-list__item" @click="lastAction = '导出 PDF'">
                导出 PDF
              </button>
            </li>
            <li>
              <button
                type="button"
                class="action-list__item action-list__item--danger"
                @click="lastAction = '删除'"
              >
                删除
              </button>
            </li>
          </ul>
        </template>
      </RsPopover>
      <p class="value">最近操作：<code>{{ lastAction }}</code></p>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.value {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
}
.content-text {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: var(--rs-line-height-normal);
}
.content-text--compact {
  font-size: var(--rs-font-size-xs);
}
.content-title {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.content-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.demo-input {
  width: 100%;
  height: var(--rs-control-height-md);
  padding: 0 0.625rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  outline: none;
}
.demo-input:focus-visible {
  border-color: var(--rs-primary);
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.placement-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 16rem;
  padding: 2rem;
  margin: 0 auto;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
}
.offset-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem 0.25rem 0.25rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-pill);
  background: var(--rs-surface);
  cursor: pointer;
  outline: none;
}
.user-trigger:focus-visible {
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.user-trigger__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--rs-primary) 18%, transparent);
  color: var(--rs-primary);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}
.user-trigger__name {
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.user-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.user-card__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--rs-primary) 18%, transparent);
  color: var(--rs-primary);
  font-weight: 600;
}
.user-card__name {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.user-card__email {
  margin: 0.125rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.user-card__bio {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.action-list {
  margin: -0.25rem;
  padding: 0;
  list-style: none;
}
.action-list__item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  text-align: left;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  cursor: pointer;
  outline: none;
}
.action-list__item:hover {
  background: var(--rs-surface-hover);
}
.action-list__item--danger {
  color: var(--rs-danger);
}
.action-list__item:focus-visible {
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.mount-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.75rem;
}
.mount-card {
  padding: 0.75rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}
.mount-card__title {
  margin: 0 0 0.375rem;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.mount-card__status {
  margin: 0 0 0.625rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.mount-card__status code {
  color: var(--rs-text);
}
</style>
