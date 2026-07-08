<script setup lang="ts">
import { computed, ref } from 'vue'
import { RsButton, RsSteps, type RsStepItem } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicStep = ref('account')

const basicItems: RsStepItem[] = [
  { value: 'account', title: '账号信息' },
  { value: 'profile', title: '个人资料' },
  { value: 'done', title: '完成' },
]

const describedStep = ref('design')

const describedItems: RsStepItem[] = [
  { value: 'design', title: '设计', description: '确定交互与视觉规范' },
  { value: 'build', title: '开发', description: '实现组件与接口' },
  { value: 'verify', title: '验收', description: 'Playground 与单测' },
]

const clickableStep = ref('billing')

const clickableItems: RsStepItem[] = [
  { value: 'plan', title: '选择方案', description: '免费版 / 专业版' },
  { value: 'billing', title: '账单信息', description: '发票与支付方式' },
  { value: 'confirm', title: '确认开通', description: '核对并提交' },
]

const verticalStep = ref('upload')

const verticalItems: RsStepItem[] = [
  { value: 'upload', title: '上传文件', description: '支持 CSV / Excel' },
  { value: 'mapping', title: '字段映射', description: '匹配列与系统字段' },
  { value: 'preview', title: '预览导入', description: '确认前 20 行数据' },
  { value: 'import', title: '执行导入' },
]

const explicitStatusItems: RsStepItem[] = [
  { value: 'submit', title: '提交申请', status: 'finish' },
  { value: 'review', title: '人工审核', status: 'error', description: '资料不完整，请补充' },
  { value: 'publish', title: '发布上线', status: 'wait' },
]

const disabledClickStep = ref('team')

const disabledClickItems: RsStepItem[] = [
  { value: 'workspace', title: '创建工作区' },
  { value: 'team', title: '邀请成员', description: '需先完成上一步' },
  { value: 'project', title: '新建项目', disabled: true },
]

const wizardStep = ref('info')
const wizardItems: RsStepItem[] = [
  { value: 'info', title: '基本信息', description: '应用名称与描述' },
  { value: 'config', title: '运行配置', description: '模型与参数' },
  { value: 'review', title: '确认创建' },
]

const wizardIndex = computed(() => wizardItems.findIndex((item) => item.value === wizardStep.value))

function wizardPrev() {
  const prev = wizardItems[wizardIndex.value - 1]
  if (prev) wizardStep.value = prev.value
}

function wizardNext() {
  const next = wizardItems[wizardIndex.value + 1]
  if (next) wizardStep.value = next.value
}
</script>

<template>
  <DemoPage title="RsSteps" test-file="RsSteps.spec.ts">
    <DemoBlock title="基础水平步骤">
      <p class="hint">
        通过 <code>v-model</code> 绑定当前步骤 <code>value</code>；未完成的步骤为
        <code>wait</code>，当前为 <code>process</code>，之前为 <code>finish</code>。
      </p>
      <RsSteps v-model="basicStep" :items="basicItems" />
      <p class="meta">当前步骤：<code>{{ basicStep }}</code></p>
    </DemoBlock>

    <DemoBlock title="带描述文案">
      <p class="hint"><code>description</code> 显示在标题下方，适合说明每步要做什么。</p>
      <RsSteps v-model="describedStep" :items="describedItems" />
    </DemoBlock>

    <DemoBlock title="可点击切换">
      <p class="hint">
        <code>clickable</code> 开启后，已完成与当前步骤可点击跳转；<code>disabled</code>
        项仍不可选。
      </p>
      <RsSteps v-model="clickableStep" :items="clickableItems" clickable />
      <p class="meta">当前步骤：<code>{{ clickableStep }}</code></p>
    </DemoBlock>

    <DemoBlock title="垂直布局">
      <p class="hint"><code>orientation="vertical"</code> 适用于侧边向导或窄屏流程。</p>
      <div class="vertical-wrap">
        <RsSteps v-model="verticalStep" :items="verticalItems" orientation="vertical" clickable />
      </div>
      <p class="meta">当前步骤：<code>{{ verticalStep }}</code></p>
    </DemoBlock>

    <DemoBlock title="小尺寸（sm）">
      <p class="hint"><code>size="sm"</code> 缩小指示器，适合嵌入卡片或紧凑表单页头。</p>
      <RsSteps v-model="basicStep" :items="basicItems" size="sm" />
    </DemoBlock>

    <DemoBlock title="显式状态覆盖">
      <p class="hint">
        为单项设置 <code>status</code> 可覆盖自动推导，例如审核失败用
        <code>error</code>。
      </p>
      <RsSteps model-value="review" :items="explicitStatusItems" />
    </DemoBlock>

    <DemoBlock title="禁用步骤">
      <p class="hint">在可点击模式下，<code>disabled: true</code> 的步骤无法被选中。</p>
      <RsSteps v-model="disabledClickStep" :items="disabledClickItems" clickable />
      <p class="meta">当前步骤：<code>{{ disabledClickStep }}</code>（「新建项目」不可点）</p>
    </DemoBlock>

    <DemoBlock title="向导流程（上一步 / 下一步）">
      <p class="hint">常见创建向导：步骤条只读展示进度，按钮驱动 <code>v-model</code> 切换。</p>
      <div class="wizard">
        <RsSteps v-model="wizardStep" :items="wizardItems" />
        <div class="wizard__panel">
          <p class="wizard__content">
            当前位于第 <strong>{{ wizardIndex + 1 }}</strong> 步：
            <code>{{ wizardStep }}</code>
          </p>
          <div class="actions">
            <RsButton
              size="sm"
              variant="default"
              :disabled="wizardIndex <= 0"
              @click="wizardPrev"
            >
              上一步
            </RsButton>
            <RsButton
              size="sm"
              :disabled="wizardIndex >= wizardItems.length - 1"
              @click="wizardNext"
            >
              下一步
            </RsButton>
          </div>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="页头组合（业务场景）">
      <p class="hint">嵌入创建页顶栏：标题 + 步骤条，指示当前配置阶段。</p>
      <header class="page-header">
        <div class="page-header__main">
          <h2 class="page-header__title">创建 AI 应用</h2>
          <p class="page-header__desc">按步骤完成基础配置后即可发布</p>
        </div>
        <RsSteps
          v-model="wizardStep"
          :items="wizardItems"
          size="sm"
          class="page-header__steps"
        />
      </header>
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
.meta {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.meta code {
  padding: 0.125rem 0.375rem;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-hover);
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  color: var(--rs-text);
}
.vertical-wrap {
  max-width: 18rem;
}
.wizard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.wizard__panel {
  padding: 1rem 1.25rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}
.wizard__content {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.page-header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
}
.page-header__title {
  margin: 0;
  font-size: var(--rs-font-size-lg);
  font-weight: 600;
  color: var(--rs-text);
  line-height: var(--rs-line-height-tight);
}
.page-header__desc {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.page-header__steps {
  width: 100%;
}
</style>
