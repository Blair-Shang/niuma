<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  RsButton,
  RsLabel,
  RsSelect,
  type RsToastPosition,
  rsToastPositions,
  useRsToast,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
import {
  playgroundToasterCloseButton,
  playgroundToasterPosition,
  playgroundToasterRichColors,
} from '../composables/playground-toaster'

const toast = useRsToast()

const lastAction = ref('（未操作）')

const positionOptions = computed(() =>
  rsToastPositions.map((value) => ({
    label: value,
    value,
  })),
)

const closeButtonOptions = [
  { label: '显示关闭按钮', value: 'true' },
  { label: '隐藏关闭按钮', value: 'false' },
]

const richColorsOptions = [
  { label: '默认描边语义色', value: 'false' },
  { label: 'vue-sonner richColors', value: 'true' },
]

const closeButtonModel = computed({
  get: () => (playgroundToasterCloseButton.value ? 'true' : 'false'),
  set: (value: string) => {
    playgroundToasterCloseButton.value = value === 'true'
  },
})

const richColorsModel = computed({
  get: () => (playgroundToasterRichColors.value ? 'true' : 'false'),
  set: (value: string) => {
    playgroundToasterRichColors.value = value === 'true'
  },
})

function log(action: string) {
  lastAction.value = action
}

function showBasic(type: 'success' | 'error' | 'info' | 'warning') {
  const messages = {
    success: '操作已成功完成',
    error: '提交失败，请稍后重试',
    info: '新版本可用，可在设置中查看',
    warning: '配额即将用尽，请及时升级',
  }
  toast[type](messages[type])
  log(`基础类型 · ${type}`)
}

function showWithDescription() {
  toast.success({
    title: '成员已邀请',
    description: '邀请邮件已发送至 user@example.com，24 小时内有效。',
  })
  log('标题 + 描述')
}

function showAtPosition(position: RsToastPosition) {
  toast.info({
    title: `位置：${position}`,
    description: '单条 Toast 可通过 position 覆盖 RsToaster 默认方位。',
    position,
  })
  log(`单条位置 · ${position}`)
}

function showShortDuration() {
  toast.info({ title: '2 秒后自动消失', duration: 2000 })
  log('短时长 2s')
}

function showLongDuration() {
  toast.warning({
    title: '10 秒内可手动关闭',
    description: '适合需要用户阅读稍长说明的场景。',
    duration: 10_000,
  })
  log('长时长 10s')
}

function showPersistent() {
  toast.error({
    title: '同步失败',
    description: '网络中断，点击关闭或下方按钮全部清除。',
    duration: Number.POSITIVE_INFINITY,
  })
  log('持久 Toast（需手动关闭）')
}

function dismissAll() {
  toast.dismiss()
  log('dismiss 全部')
}

function simulateFormSave() {
  toast.success('设置已保存')
  log('业务 · 表单保存')
}

function simulateApiError() {
  toast.error({
    title: '请求失败 (502)',
    description: '网关超时，请检查网络或联系管理员。',
  })
  log('业务 · API 错误')
}

function simulateCopySuccess() {
  toast.success({
    title: '已复制到剪贴板',
    description: 'sk-live-••••••••••••••••',
    duration: 2500,
  })
  log('业务 · 复制成功')
}

function simulateBatchPartial() {
  toast.warning({
    title: '批量导入完成',
    description: '成功 18 条，失败 2 条。可在导入记录中查看详情。',
  })
  log('业务 · 批量部分失败')
}

function simulateDeleteSuccess() {
  toast.success({
    title: '项目已移至回收站',
    description: '30 天内可从回收站恢复。',
  })
  log('业务 · 删除成功')
}
</script>

<template>
  <DemoPage title="RsToaster" test-file="RsToaster.spec.ts">
    <DemoBlock title="基础类型">
      <p class="hint">
        通过 <code>useRsToast()</code> 触发；需在应用根节点挂载
        <code>&lt;RsToaster /&gt;</code>（Playground 已在 App 中挂载）。
      </p>
      <div class="row">
        <RsButton size="sm" @click="showBasic('success')">success</RsButton>
        <RsButton size="sm" variant="default" @click="showBasic('info')">info</RsButton>
        <RsButton size="sm" variant="default" @click="showBasic('warning')">warning</RsButton>
        <RsButton size="sm" variant="default" @click="showBasic('error')">error</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="标题与描述">
      <p class="hint">
        传入对象 <code>{ title, description? }</code>；样式类
        <code>rs-toast__title</code> / <code>rs-toast__description</code> 由 RsToaster 统一配置。
      </p>
      <RsButton size="sm" @click="showWithDescription">发送带描述的 Toast</RsButton>
    </DemoBlock>

    <DemoBlock title="RsToaster 全局配置">
      <p class="hint">
        以下选项作用于根节点 <code>RsToaster</code>，切换后新弹出的 Toast 立即生效。默认位置
        <code>top-center</code>。
      </p>
      <div class="config-grid">
        <div class="config-field">
          <RsLabel>position</RsLabel>
          <RsSelect v-model="playgroundToasterPosition" :options="positionOptions" size="sm" />
        </div>
        <div class="config-field">
          <RsLabel>closeButton</RsLabel>
          <RsSelect v-model="closeButtonModel" :options="closeButtonOptions" size="sm" />
        </div>
        <div class="config-field">
          <RsLabel>richColors</RsLabel>
          <RsSelect v-model="richColorsModel" :options="richColorsOptions" size="sm" />
        </div>
      </div>
      <RsButton size="sm" variant="default" @click="toast.info('当前 RsToaster 配置已应用')">
        用当前配置弹出 Toast
      </RsButton>
    </DemoBlock>

    <DemoBlock title="单条 Toast 位置覆盖">
      <p class="hint">
        <code>useRsToast</code> 可在单条消息上指定 <code>position</code>，覆盖 RsToaster 默认值。
      </p>
      <div class="position-grid">
        <RsButton
          v-for="pos in rsToastPositions"
          :key="pos"
          size="sm"
          variant="default"
          @click="showAtPosition(pos)"
        >
          {{ pos }}
        </RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="持续时间与关闭">
      <p class="hint">
        <code>duration</code> 单位为毫秒；极大值表示需用户手动关闭。右上角关闭按钮由
        <code>closeButton</code> 控制。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="showShortDuration">2 秒</RsButton>
        <RsButton size="sm" variant="default" @click="showLongDuration">10 秒</RsButton>
        <RsButton size="sm" variant="default" @click="showPersistent">持久</RsButton>
        <RsButton size="sm" variant="default" @click="dismissAll">dismiss 全部</RsButton>
      </div>
    </DemoBlock>

    <DemoBlock title="业务场景示例">
      <p class="hint">常见 SaaS 反馈：保存、接口错误、复制、批量结果、软删除等。</p>
      <div class="stack">
        <div class="panel">
          <p class="panel-label">设置页保存</p>
          <RsButton size="sm" @click="simulateFormSave">保存更改</RsButton>
        </div>
        <div class="panel">
          <p class="panel-label">API 请求失败</p>
          <RsButton size="sm" variant="default" @click="simulateApiError">模拟 502</RsButton>
        </div>
        <div class="panel">
          <p class="panel-label">复制密钥</p>
          <RsButton size="sm" variant="default" @click="simulateCopySuccess">复制 API Key</RsButton>
        </div>
        <div class="panel">
          <p class="panel-label">批量导入</p>
          <RsButton size="sm" variant="default" @click="simulateBatchPartial">完成导入</RsButton>
        </div>
        <div class="panel">
          <p class="panel-label">删除确认后</p>
          <RsButton size="sm" variant="default" @click="simulateDeleteSuccess">删除项目</RsButton>
        </div>
      </div>
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
  gap: 0.75rem;
}
.position-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.5rem;
}
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}
.config-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-bg);
}
.panel-label {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.value {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
}
</style>
