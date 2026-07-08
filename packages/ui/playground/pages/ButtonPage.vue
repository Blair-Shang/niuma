<script setup lang="ts">
import { ref, type Ref } from 'vue'
import { RsButton } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const loadingShort = ref(false)
const loadingLong = ref(false)
const loadingSecondary = ref(false)
const loadingToggle = ref(false)
const elapsedMs = ref(0)
let timerId: ReturnType<typeof setInterval> | undefined

function clearTimer() {
  if (timerId !== undefined) {
    clearInterval(timerId)
    timerId = undefined
  }
}

function startLoading(
  target: Ref<boolean>,
  durationMs: number,
) {
  clearTimer()
  elapsedMs.value = 0
  target.value = true
  const started = performance.now()
  timerId = setInterval(() => {
    elapsedMs.value = Math.round(performance.now() - started)
  }, 100)
  globalThis.setTimeout(() => {
    target.value = false
    clearTimer()
  }, durationMs)
}

function runSecondaryLoad() {
  startLoading(loadingSecondary, 5000)
}

function runShortLoad() {
  startLoading(loadingShort, 2000)
}

function runLongLoad() {
  startLoading(loadingLong, 10000)
}
</script>

<template>
  <DemoPage title="RsButton" test-file="RsButton.spec.ts">
    <DemoBlock title="Loading 转圈（连接对话框同款）">
      <p class="hint">
        模拟 FTP「测试连接」：loading 期间转圈应持续旋转直至结束（Windows 关闭「动画效果」时亦如此）。
        下方计时器用于确认等待时长。
      </p>
      <p v-if="loadingShort || loadingLong || loadingSecondary" class="timer">
        已等待 {{ elapsedMs }} ms
      </p>
      <div class="row">
        <RsButton
          variant="secondary"
          class="test-conn-btn"
          :loading="loadingSecondary"
          @click="runSecondaryLoad"
        >
          测试连接
        </RsButton>
        <RsButton
          variant="default"
          :loading="loadingShort"
          @click="runShortLoad"
        >
          短加载 2s
        </RsButton>
        <RsButton
          variant="primary"
          :loading="loadingLong"
          @click="runLongLoad"
        >
          长加载 10s
        </RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="Loading 开关">
      <p class="hint">
        切换 loading 时不应出现 disabled 导致的动画停滞；spinner 使用独立合成层旋转。
      </p>
      <div class="row">
        <RsButton variant="default" @click="loadingToggle = !loadingToggle">
          {{ loadingToggle ? '停止 loading' : '开始 loading' }}
        </RsButton>
        <RsButton variant="ghost" :loading="loadingToggle">保存</RsButton>
        <RsButton variant="primary" :loading="loadingToggle" icon="check">提交</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="变体">
      <div class="row">
        <RsButton>主要按钮</RsButton>
        <RsButton variant="default">默认按钮</RsButton>
        <RsButton variant="ghost">文字按钮</RsButton>
        <RsButton disabled>禁用</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="尺寸 sm / md / lg（Ant 三档）">
      <div class="row">
        <RsButton size="sm">小</RsButton>
        <RsButton size="md">中（默认）</RsButton>
        <RsButton size="lg">大</RsButton>
      </div>
      <div class="row">
        <RsButton variant="default" size="sm">小</RsButton>
        <RsButton variant="default" size="md">中</RsButton>
        <RsButton variant="default" size="lg">大</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="前缀图标 + 文字">
      <div class="row">
        <RsButton icon="plus">新建对话</RsButton>
        <RsButton icon="search" variant="ghost">搜索</RsButton>
        <RsButton icon="settings" disabled>设置（禁用）</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="仅图标 · 悬浮 tooltip">
      <p class="hint">鼠标悬停显示说明文字，适合工具栏紧凑布局。</p>
      <div class="row">
        <RsButton icon="plus" icon-only tooltip="新建对话" />
        <RsButton icon="search" icon-only tooltip="搜索" variant="ghost" />
        <RsButton icon="message-square" icon-only variant="ghost">消息</RsButton>
        <RsButton icon="settings" icon-only tooltip="设置" disabled />
      </div>
    </DemoBlock>

    <DemoBlock title="图标 + 悬浮展开文字（reveal-label）">
      <p class="hint">默认只显示图标，悬停时平滑展开 slot 文案。</p>
      <div class="row">
        <RsButton icon="plus" reveal-label>新建对话</RsButton>
        <RsButton icon="folder" reveal-label variant="ghost">打开项目</RsButton>
        <RsButton icon="user" reveal-label variant="ghost">个人中心</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="前缀图标 + 额外 tooltip">
      <p class="hint">有文字时也可加 tooltip 作补充说明。</p>
      <div class="row">
        <RsButton icon="plus" tooltip="快捷键 Ctrl+N">新建</RsButton>
        <RsButton icon="check" variant="ghost" tooltip="保存并提交审核">提交</RsButton>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.timer {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-sm);
  font-variant-numeric: tabular-nums;
  color: var(--rs-primary);
}
.test-conn-btn {
  min-width: 7.5rem;
}
</style>
