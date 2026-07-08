<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsDialog, type RsFeedbackTone } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicOpen = ref(false)
const descOpen = ref(false)

const widthOpen = ref(false)
const widthPreset = ref<'sm' | 'md' | 'lg'>('md')

const footerOpen = ref(false)

const overlayCloseOpen = ref(false)
const noOverlayOpen = ref(false)
const noCloseOpen = ref(false)

const windowOpen = ref(false)

const toneOpen = ref(false)
const toneConfig = ref<{ tone: RsFeedbackTone; title: string }>({
  tone: 'default',
  title: '',
})
</script>

<template>
  <DemoPage title="RsDialog" test-file="RsDialog.spec.ts">
    <DemoBlock title="confirm 布局（默认）">
      <p class="hint">
        默认 <code>layout="confirm"</code>，居中模态，适合表单或信息展示；通过
        <code>v-model:open</code> 控制显隐。
      </p>
      <RsButton @click="basicOpen = true">打开对话框</RsButton>
      <RsDialog v-model:open="basicOpen" title="编辑成员">
        <p class="body-text">在此放置表单或说明内容，body 区域可滚动。</p>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="标题与描述">
      <RsButton variant="default" @click="descOpen = true">查看详情</RsButton>
      <RsDialog
        v-model:open="descOpen"
        title="API 密钥"
        description="密钥仅显示一次，请妥善保存。"
      >
        <p class="body-text mono">sk-live-••••••••••••••••</p>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="宽度预设 width">
      <p class="hint"><code>sm</code> / <code>md</code> / <code>lg</code> 控制 confirm 布局最大宽度。</p>
      <div class="row">
        <RsButton
          v-for="w in (['sm', 'md', 'lg'] as const)"
          :key="w"
          size="sm"
          variant="default"
          @click="widthPreset = w; widthOpen = true"
        >
          {{ w }}
        </RsButton>
      </div>
      <RsDialog v-model:open="widthOpen" :width="widthPreset" :title="`width: ${widthPreset}`">
        <p class="body-text">当前宽度预设为 <code>{{ widthPreset }}</code>。</p>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="footer 插槽">
      <RsButton @click="footerOpen = true">保存设置</RsButton>
      <RsDialog v-model:open="footerOpen" title="通知偏好" description="选择接收渠道与频率。">
        <p class="body-text">邮件、站内信、移动端推送等选项可放在 body 中。</p>
        <template #footer>
          <RsButton variant="default" @click="footerOpen = false">取消</RsButton>
          <RsButton @click="footerOpen = false">保存</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="点击遮罩关闭">
      <p class="hint">默认点击遮罩不关闭；设置 <code>close-on-overlay-click</code> 后允许关闭。</p>
      <RsButton variant="default" @click="overlayCloseOpen = true">打开（可点遮罩关闭）</RsButton>
      <RsDialog
        v-model:open="overlayCloseOpen"
        title="草稿已自动保存"
        close-on-overlay-click
      >
        <p class="body-text">点击对话框外灰色区域可关闭。</p>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="无遮罩 / 无关闭按钮">
      <p class="hint">
        <code>show-overlay</code> 与 <code>show-close</code> 可独立关闭，适合嵌套面板或受控流程。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="noOverlayOpen = true">无遮罩</RsButton>
        <RsButton size="sm" variant="default" @click="noCloseOpen = true">无关闭按钮</RsButton>
      </div>
      <RsDialog v-model:open="noOverlayOpen" title="无遮罩层" :show-overlay="false">
        <p class="body-text">背景页面仍可交互，请通过 footer 或业务逻辑关闭。</p>
        <template #footer>
          <RsButton @click="noOverlayOpen = false">完成</RsButton>
        </template>
      </RsDialog>
      <RsDialog v-model:open="noCloseOpen" title="无右上角关闭" :show-close="false">
        <p class="body-text">仅能通过 footer 或外部状态关闭。</p>
        <template #footer>
          <RsButton @click="noCloseOpen = false">知道了</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="window 布局（拖拽 · 缩放 · 全屏）">
      <p class="hint">
        <code>layout="window"</code> 配合 <code>draggable</code>、<code>resizable</code>、
        <code>fullscreenable</code>；标题栏可拖拽，边缘可缩放，支持全屏切换。关闭按钮 tooltip 随
        Playground 语言切换（<code>t('dialog.*')</code>）。
      </p>
      <RsButton @click="windowOpen = true">打开窗口</RsButton>
      <RsDialog
        v-model:open="windowOpen"
        layout="window"
        width="lg"
        draggable
        resizable
        fullscreenable
        title="数据预览"
        description="可拖动标题栏、拖拽边缘调整大小。"
      >
        <p class="body-text">
          窗口模式适合 IDE 式多面板、预览器或长时间操作场景。尝试拖动标题栏与四边/四角手柄。
        </p>
        <template #footer>
          <RsButton variant="default" @click="windowOpen = false">关闭</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="tone 语义类">
      <p class="hint">预留 <code>tone</code> 修饰类，可与业务图标或强调色组合使用。</p>
      <div class="row">
        <RsButton
          v-for="tone in (['danger', 'warning', 'success', 'info', 'default'] as const)"
          :key="tone"
          size="sm"
          variant="default"
          @click="toneConfig = { tone, title: `tone: ${tone}` }; toneOpen = true"
        >
          {{ tone }}
        </RsButton>
      </div>
      <RsDialog
        v-model:open="toneOpen"
        :tone="toneConfig.tone"
        :title="toneConfig.title"
        description="内容区可配合 RsIcon 等展示语义反馈。"
      >
        <p class="body-text">当前 tone：<code>{{ toneConfig.tone }}</code></p>
      </RsDialog>
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
}
.body-text {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: var(--rs-line-height-normal);
}
.body-text.mono {
  font-family: ui-monospace, monospace;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
