<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsConfirmDialog, type RsFeedbackTone } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const defaultOpen = ref(false)
const deleteOpen = ref(false)
const customButtonsOpen = ref(false)
const primaryConfirmOpen = ref(false)
const eventOpen = ref(false)
const scopedConfirmOpen = ref(false)
const scopedConfirmMount = 'pg-confirm-dialog-mount'

const toneOpen = ref(false)
const toneConfig = ref<{
  tone: RsFeedbackTone
  title: string
  description: string
  confirmVariant: 'primary' | 'danger'
}>({
  tone: 'danger',
  title: '',
  description: '',
  confirmVariant: 'danger',
})

const lastEvent = ref('（尚未操作）')

function openTone(
  tone: RsFeedbackTone,
  title: string,
  description: string,
  confirmVariant: 'primary' | 'danger' = tone === 'danger' ? 'danger' : 'primary',
): void {
  toneConfig.value = { tone, title, description, confirmVariant }
  toneOpen.value = true
}

function logEvent(name: string): void {
  lastEvent.value = `${name} · ${new Date().toLocaleTimeString()}`
}
</script>

<template>
  <DemoPage title="RsConfirmDialog" test-file="RsConfirmDialog.spec.ts">
    <DemoBlock title="默认 i18n 文案">
      <p class="hint">
        不传 <code>title</code> / <code>description</code> 时使用
        <code>t('confirm.*')</code>，随 Playground 语言切换。
      </p>
      <RsButton @click="defaultOpen = true">打开确认框</RsButton>
      <RsConfirmDialog v-model:open="defaultOpen" />
    </DemoBlock>

    <DemoBlock title="危险删除（默认 tone）">
      <p class="hint">
        默认 <code>tone="danger"</code>、<code>confirmVariant="danger"</code>，适合不可逆操作。
      </p>
      <RsButton variant="default" @click="deleteOpen = true">删除任务</RsButton>
      <RsConfirmDialog
        v-model:open="deleteOpen"
        title="删除任务？"
        description="删除后数据无法恢复，相关流程将立即停止。"
        confirm-text="删除"
        cancel-text="保留"
      />
    </DemoBlock>

    <DemoBlock title="tone 语义色">
      <p class="hint">图标背景使用 container 语义色，避免大面积高饱和功能色。</p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="openTone('danger', '删除工作区？', '所有成员将失去访问权限。')">
          danger
        </RsButton>
        <RsButton size="sm" variant="default" @click="openTone('warning', '发布到生产？', '当前版本尚未通过全部检查。')">
          warning
        </RsButton>
        <RsButton size="sm" variant="default" @click="openTone('success', '标记为已完成？', '任务将移入归档列表。')">
          success
        </RsButton>
        <RsButton size="sm" variant="default" @click="openTone('info', '切换计费方案？', '变更将在下个账单周期生效。')">
          info
        </RsButton>
        <RsButton size="sm" variant="default" @click="openTone('default', '重置筛选条件？', '将恢复为默认视图。')">
          default
        </RsButton>
      </div>
      <RsConfirmDialog
        v-model:open="toneOpen"
        :tone="toneConfig.tone"
        :title="toneConfig.title"
        :description="toneConfig.description"
        :confirm-variant="toneConfig.confirmVariant"
      />
    </DemoBlock>

    <DemoBlock title="非破坏性确认（confirmVariant=primary）">
      <p class="hint">非删除类操作可将确认按钮改为品牌主色，降低误触恐慌感。</p>
      <RsButton @click="primaryConfirmOpen = true">提交审核</RsButton>
      <RsConfirmDialog
        v-model:open="primaryConfirmOpen"
        tone="info"
        confirm-variant="primary"
        title="提交审核？"
        description="提交后进入审核队列，审核期间不可编辑。"
        confirm-text="提交"
      />
    </DemoBlock>

    <DemoBlock title="自定义按钮文案">
      <RsButton variant="default" @click="customButtonsOpen = true">退出协作</RsButton>
      <RsConfirmDialog
        v-model:open="customButtonsOpen"
        tone="warning"
        title="退出当前协作？"
        description="未保存的批注将丢失。"
        confirm-text="退出"
        cancel-text="继续编辑"
        confirm-variant="danger"
      />
    </DemoBlock>

    <DemoBlock title="confirm / cancel 事件">
      <p class="hint">
        点击确认触发 <code>confirm</code> 并关闭；取消触发 <code>cancel</code>（由 AlertDialog 关闭）。
      </p>
      <div class="row">
        <RsButton @click="eventOpen = true">触发事件</RsButton>
        <span class="event-log">最近操作：<code>{{ lastEvent }}</code></span>
      </div>
      <RsConfirmDialog
        v-model:open="eventOpen"
        title="保存更改？"
        description="离开页面前是否保存当前编辑内容。"
        confirm-text="保存"
        cancel-text="不保存"
        confirm-variant="primary"
        @confirm="logEvent('confirm')"
        @cancel="logEvent('cancel')"
      />
    </DemoBlock>

    <DemoBlock title="teleportTo 挂载点（页签隔离）">
      <p class="hint">
        ConfirmDialog 同样支持 <code>teleport-to</code>，可挂载到当前页签容器，避免跨页签覆盖。
      </p>
      <RsButton variant="default" @click="scopedConfirmOpen = true">打开挂载点确认框</RsButton>
      <div :id="scopedConfirmMount" class="scoped-mount" />
      <RsConfirmDialog
        v-model:open="scopedConfirmOpen"
        title="挂载点确认"
        description="此确认框挂载到本页指定 id。"
        :teleport-to="`#${scopedConfirmMount}`"
      />
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
.event-log {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.event-log code {
  font-size: inherit;
  color: var(--rs-text);
}
.scoped-mount {
  position: relative;
}
</style>
