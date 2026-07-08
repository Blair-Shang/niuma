<script setup lang="ts">
import { computed, ref } from 'vue'
import { RsUpload } from '@ruoshui/ui'
import type { RsUploadValidationError } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicFiles = ref<File[]>([])
const multipleFiles = ref<File[]>([])
const imageFiles = ref<File[]>([])
const limitedSizeFiles = ref<File[]>([])
const limitedCountFiles = ref<File[]>([])
const disabledFiles = ref<File[]>([new File(['demo'], 'readonly.txt', { type: 'text/plain' })])

const rejectLog = ref<RsUploadValidationError[]>([])

const rejectSummary = computed(() => {
  if (!rejectLog.value.length) return ''
  return rejectLog.value
    .map(({ file, reason }) => `${file.name}（${reasonLabel(reason)}）`)
    .join('、')
})

function reasonLabel(reason: RsUploadValidationError['reason']): string {
  if (reason === 'accept') return '类型不符'
  if (reason === 'maxSize') return '超出大小'
  return '超出数量'
}

function onReject(errors: RsUploadValidationError[]): void {
  rejectLog.value = errors
}
</script>

<template>
  <DemoPage title="RsUpload" test-file="RsUpload.spec.ts">
    <DemoBlock title="基础上传">
      <p class="hint">
        单文件模式（默认 <code>multiple=false</code>），选中后展示文件名与大小，可点击「移除」。
      </p>
      <RsUpload v-model="basicFiles" />
      <p v-if="basicFiles.length" class="state">
        已选 {{ basicFiles.length }} 个文件：{{ basicFiles.map((f) => f.name).join('、') }}
      </p>
    </DemoBlock>

    <DemoBlock title="多文件">
      <p class="hint"><code>multiple</code> 开启后可一次选择多个文件，列表逐条展示。</p>
      <RsUpload v-model="multipleFiles" multiple />
    </DemoBlock>

    <DemoBlock title="自定义文案">
      <p class="hint">
        <code>label</code> / <code>hint</code> 由业务传入；未传 <code>label</code> 时走 i18n
        <code>upload.label</code>。
      </p>
      <RsUpload
        v-model="basicFiles"
        label="上传附件"
        hint="支持 PDF、Word，单个文件不超过 10 MB"
        accept=".pdf,.doc,.docx,application/pdf"
      />
    </DemoBlock>

    <DemoBlock title="类型限制（accept）">
      <p class="hint">
        仅允许图片（<code>accept="image/*"</code>）。选择其他类型会触发 <code>reject</code> 事件。
      </p>
      <RsUpload
        v-model="imageFiles"
        multiple
        accept="image/*"
        label="上传图片"
        hint="PNG / JPG / WebP 等图片格式"
        @reject="onReject"
      />
    </DemoBlock>

    <DemoBlock title="大小限制（maxSize）">
      <p class="hint">
        <code>maxSize</code> 单位为字节，此处限制 100 KB。超大文件会被拒绝并触发
        <code>reject</code>。
      </p>
      <RsUpload
        v-model="limitedSizeFiles"
        :max-size="100 * 1024"
        label="小文件上传"
        hint="单个文件 ≤ 100 KB"
        @reject="onReject"
      />
    </DemoBlock>

    <DemoBlock title="数量限制（maxCount）">
      <p class="hint">
        最多 3 个文件；达到上限后上传区进入禁用态，继续选择会触发 <code>reject</code>。
      </p>
      <RsUpload
        v-model="limitedCountFiles"
        multiple
        :max-count="3"
        label="最多 3 个文件"
        @reject="onReject"
      />
      <p class="state">当前 {{ limitedCountFiles.length }} / 3</p>
    </DemoBlock>

    <DemoBlock title="禁用态">
      <p class="hint"><code>disabled</code> 时不可选择新文件，已有列表仍可展示。</p>
      <RsUpload v-model="disabledFiles" disabled label="上传已关闭" />
    </DemoBlock>

    <DemoBlock title="校验拒绝反馈">
      <p class="hint">
        在上方「类型 / 大小 / 数量」场景中尝试违规文件，下方会汇总最近一次
        <code>reject</code> 载荷。业务侧可据此弹出 Toast 或行内错误。
      </p>
      <div class="reject-panel" :class="{ 'reject-panel--empty': !rejectLog.length }">
        <p v-if="rejectLog.length" class="reject-text">{{ rejectSummary }}</p>
        <p v-else class="reject-placeholder">暂无拒绝记录，请尝试上传不符合规则的文件。</p>
      </div>
    </DemoBlock>

    <DemoBlock title="i18n 默认文案">
      <p class="hint">
        未设置 <code>label</code> 时使用 <code>upload.label</code>。切换 Playground 右上角语言可目测
        zh-CN / en-US 变化。
      </p>
      <RsUpload v-model="basicFiles" />
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
.state {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.reject-panel {
  padding: 0.75rem 1rem;
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-danger);
  background: var(--rs-danger-container);
}
.reject-panel--empty {
  border-color: var(--rs-border-subtle);
  background: var(--rs-surface);
}
.reject-text {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-on-danger-container);
  line-height: var(--rs-line-height-normal);
}
.reject-placeholder {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
</style>
