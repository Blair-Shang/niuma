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
const fullscreenOpen = ref(false)
const dragOpen = ref(false)

const toneOpen = ref(false)
const toneConfig = ref<{ tone: RsFeedbackTone; title: string }>({
  tone: 'default',
  title: '',
})

const scopedPanel = ref<'A' | 'B'>('A')
const scopedOpenA = ref(false)
const scopedOpenB = ref(false)
const scopedMountA = 'pg-dialog-mount-a'
const scopedMountB = 'pg-dialog-mount-b'
</script>

<template>
  <DemoPage title="RsDialog" test-file="RsDialog.spec.ts">
    <DemoBlock title="window 布局（默认）">
      <p class="hint">
        默认 <code>layout="window"</code>，支持边缘缩放与全屏；通过
        <code>v-model:open</code> 控制显隐。标题栏拖拽需额外设置 <code>draggable</code>。
        简单表单可设 <code>layout="confirm"</code> 并关闭缩放。
      </p>
      <RsButton @click="basicOpen = true">打开对话框</RsButton>
      <RsDialog v-model:open="basicOpen" title="编辑成员">
        <template #body>
          <p class="body-text">在此放置表单或说明内容，body 区域可滚动。</p>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="全屏切换">
      <p class="hint">
        点击标题栏右侧全屏按钮，窗口应平滑展开至安全区；再次点击恢复先前尺寸与位置。
      </p>
      <RsButton @click="fullscreenOpen = true">打开可全屏窗口</RsButton>
      <RsDialog
        v-model:open="fullscreenOpen"
        title="全屏测试"
        description="尝试全屏与还原，观察过渡是否流畅。"
      >
        <template #body>
        <p class="body-text">
          全屏时占满 <code>--rs-dialog-inset-*</code> 安全区；还原后回到切换前的窗口大小。
        </p>
        </template>
        <template #footer>
          <RsButton variant="default" @click="fullscreenOpen = false">关闭</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="标题栏拖拽">
      <p class="hint">
        设置 <code>draggable</code> 后标题栏可拖动（按钮区域除外）。边缘手柄仍可调整大小。
      </p>
      <RsButton @click="dragOpen = true">打开可拖拽窗口</RsButton>
      <RsDialog
        v-model:open="dragOpen"
        width="lg"
        draggable
        title="拖拽测试"
        description="按住标题栏空白处拖动窗口。"
      >
        <template #body>
        <p class="body-text">
          拖动标题栏移动窗口；拖四边/四角手柄调整大小。全屏后标题栏不可再拖。
        </p>
        </template>
        <template #footer>
          <RsButton variant="default" @click="dragOpen = false">关闭</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="标题与描述">
      <RsButton variant="default" @click="descOpen = true">查看详情</RsButton>
      <RsDialog
        v-model:open="descOpen"
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        title="API 密钥"
        description="密钥仅显示一次，请妥善保存。"
      >
        <template #body>
          <p class="body-text mono">sk-live-••••••••••••••••</p>
        </template>
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
      <RsDialog
        v-model:open="widthOpen"
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        :width="widthPreset"
        :title="`width: ${widthPreset}`"
      >
        <template #body>
          <p class="body-text">当前宽度预设为 <code>{{ widthPreset }}</code>。</p>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="footer 插槽">
      <RsButton @click="footerOpen = true">保存设置</RsButton>
      <RsDialog
        v-model:open="footerOpen"
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        title="通知偏好"
        description="选择接收渠道与频率。"
      >
        <template #body>
          <p class="body-text">邮件、站内信、移动端推送等选项可放在 body 中。</p>
        </template>
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
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        title="草稿已自动保存"
        close-on-overlay-click
      >
        <template #body>
          <p class="body-text">点击对话框外灰色区域可关闭。</p>
        </template>
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
      <RsDialog
        v-model:open="noOverlayOpen"
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        title="无遮罩层"
        :show-overlay="false"
      >
        <template #body>
          <p class="body-text">背景页面仍可交互，请通过 footer 或业务逻辑关闭。</p>
        </template>
        <template #footer>
          <RsButton @click="noOverlayOpen = false">完成</RsButton>
        </template>
      </RsDialog>
      <RsDialog
        v-model:open="noCloseOpen"
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        title="无右上角关闭"
        :show-close="false"
      >
        <template #body>
          <p class="body-text">仅能通过 footer 或外部状态关闭。</p>
        </template>
        <template #footer>
          <RsButton @click="noCloseOpen = false">知道了</RsButton>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="缩放 + 全屏 + 拖拽（组合）">
      <p class="hint">
        同时启用 <code>draggable</code>、边缘缩放与全屏，适合 IDE 式多面板或预览器场景。
      </p>
      <RsButton @click="windowOpen = true">打开组合窗口</RsButton>
      <RsDialog
        v-model:open="windowOpen"
        width="lg"
        draggable
        title="数据预览"
        description="可拖动标题栏、拖拽边缘调整大小。"
      >
        <template #body>
        <p class="body-text">
          窗口模式适合 IDE 式多面板、预览器或长时间操作场景。尝试拖动标题栏与四边/四角手柄。
        </p>
        </template>
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
        layout="confirm"
        :resizable="false"
        :fullscreenable="false"
        :tone="toneConfig.tone"
        :title="toneConfig.title"
        description="内容区可配合 RsIcon 等展示语义反馈。"
      >
        <template #body>
          <p class="body-text">当前 tone：<code>{{ toneConfig.tone }}</code></p>
        </template>
      </RsDialog>
    </DemoBlock>

    <DemoBlock title="teleportTo 挂载点隔离（多页签模拟）">
      <p class="hint">
        通过 <code>teleport-to</code> 将 DialogPortal 挂到实例专属 id。切换页签（这里用 A/B 模拟）后，
        对话框仅在对应挂载点生效，避免覆盖当前活动页签。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="scopedPanel = 'A'">切到 Panel A</RsButton>
        <RsButton size="sm" variant="default" @click="scopedPanel = 'B'">切到 Panel B</RsButton>
        <span class="meta">当前：<code>{{ scopedPanel }}</code></span>
      </div>

      <section v-if="scopedPanel === 'A'" class="scoped-card">
        <header class="scoped-card__head">Panel A</header>
        <RsButton size="sm" @click="scopedOpenA = true">打开 A 对话框</RsButton>
        <div :id="scopedMountA" class="scoped-mount" />
        <RsDialog
          v-model:open="scopedOpenA"
          title="Panel A 对话框"
          :teleport-to="`#${scopedMountA}`"
          :show-overlay="false"
          :modal="false"
        >
          <template #body>
            <p class="body-text">挂载到 #{{ scopedMountA }}</p>
          </template>
        </RsDialog>
      </section>

      <section v-else class="scoped-card">
        <header class="scoped-card__head">Panel B</header>
        <RsButton size="sm" @click="scopedOpenB = true">打开 B 对话框</RsButton>
        <div :id="scopedMountB" class="scoped-mount" />
        <RsDialog
          v-model:open="scopedOpenB"
          title="Panel B 对话框"
          :teleport-to="`#${scopedMountB}`"
          :show-overlay="false"
          :modal="false"
        >
          <template #body>
            <p class="body-text">挂载到 #{{ scopedMountB }}</p>
          </template>
        </RsDialog>
      </section>
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
.meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.meta code {
  color: var(--rs-text);
}
.scoped-card {
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-sm);
  padding: var(--rs-space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}
.scoped-card__head {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 600;
}
.scoped-mount {
  position: relative;
}
</style>
