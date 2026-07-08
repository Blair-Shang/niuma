<script setup lang="ts">
import { ref } from 'vue'
import {
  RsButton,
  RsForm,
  RsInput,
  RsLabel,
  RsSelect,
  type RsSelectOption,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicName = ref('弱水工作室')
const basicEmail = ref('team@ruoshui.app')

const validateFormRef = ref<InstanceType<typeof RsForm> | null>(null)
const validateName = ref('')
const validateEmail = ref('')
const validateResult = ref('（尚未校验）')

const resetFormRef = ref<InstanceType<typeof RsForm> | null>(null)
const resetName = ref('默认名称')
const resetRole = ref('member')

const mixedFormRef = ref<InstanceType<typeof RsForm> | null>(null)
const mixedName = ref('')
const mixedRole = ref('')
const mixedResult = ref('')

const disabledName = ref('只读名称')
const disabledEmail = ref('readonly@ruoshui.app')

const sizePreset = ref<'sm' | 'md' | 'lg'>('md')
const sizeName = ref('')
const sizeEmail = ref('')

const leftName = ref('')
const leftEmail = ref('')

const roleOptions: RsSelectOption[] = [
  { label: '管理员', value: 'admin' },
  { label: '成员', value: 'member' },
  { label: '访客', value: 'guest' },
]

async function runValidate(): Promise<void> {
  const result = await validateFormRef.value?.validate()
  validateResult.value = result?.valid ? '校验通过' : '存在未通过的字段'
}

async function runMixedValidate(): Promise<void> {
  const result = await mixedFormRef.value?.validate()
  mixedResult.value = result?.valid ? '可提交' : '请补全必填项'
}

function runReset(): void {
  resetFormRef.value?.resetFields()
}

function runClearValidation(): void {
  resetFormRef.value?.clearValidation()
}
</script>

<template>
  <DemoPage title="RsForm" test-file="RsForm.spec.ts">
    <DemoBlock title="基础表单">
      <p class="hint">
        <code>RsInput</code> 使用内置 <code>label</code>；<code>RsSelect</code> 等仍配合
        <code>RsLabel</code>。
      </p>
      <RsForm max-width="md">
        <RsInput v-model="basicName" label="名称" required placeholder="工作区名称" />
        <RsInput
          v-model="basicEmail"
          label="邮箱"
          hint="用于登录与通知"
          type="email"
          rule="email"
          required
          placeholder="you@example.com"
        />
      </RsForm>
    </DemoBlock>

    <DemoBlock title="校验与提交（validate）">
      <RsForm ref="validateFormRef" max-width="md">
        <RsInput v-model="validateName" label="名称" required placeholder="必填" />
        <RsInput
          v-model="validateEmail"
          label="邮箱"
          type="email"
          rule="email"
          required
          placeholder="you@example.com"
        />
        <div class="row">
          <RsButton @click="runValidate">校验表单</RsButton>
          <span class="result">结果：<code>{{ validateResult }}</code></span>
        </div>
      </RsForm>
    </DemoBlock>

    <DemoBlock title="重置与清除校验">
      <RsForm ref="resetFormRef" max-width="md">
        <RsInput v-model="resetName" label="名称" required />
        <div class="field">
          <RsLabel for-id="form-reset-role">角色</RsLabel>
          <RsSelect
            id="form-reset-role"
            v-model="resetRole"
            :options="roleOptions"
            placeholder="选择角色"
          />
        </div>
        <div class="row">
          <RsButton variant="default" @click="runReset">重置字段</RsButton>
          <RsButton variant="default" @click="runClearValidation">清除校验</RsButton>
        </div>
      </RsForm>
    </DemoBlock>

    <DemoBlock title="混合字段（Input + Select）">
      <RsForm ref="mixedFormRef" max-width="md">
        <RsInput v-model="mixedName" label="成员名称" required placeholder="姓名" />
        <div class="field">
          <RsLabel for-id="form-mixed-role" required>角色</RsLabel>
          <RsSelect
            id="form-mixed-role"
            v-model="mixedRole"
            :options="roleOptions"
            required
            placeholder="选择角色"
          />
        </div>
        <div class="row">
          <RsButton @click="runMixedValidate">提交</RsButton>
          <span v-if="mixedResult" class="result"><code>{{ mixedResult }}</code></span>
        </div>
      </RsForm>
    </DemoBlock>

    <DemoBlock title="整表禁用">
      <RsForm disabled max-width="md">
        <RsInput v-model="disabledName" label="名称" />
        <RsInput v-model="disabledEmail" label="邮箱" type="email" />
      </RsForm>
    </DemoBlock>

    <DemoBlock title="表单级尺寸 size">
      <div class="row row--mb">
        <RsButton
          v-for="s in (['sm', 'md', 'lg'] as const)"
          :key="s"
          size="sm"
          :variant="sizePreset === s ? 'primary' : 'default'"
          @click="sizePreset = s"
        >
          {{ s }}
        </RsButton>
      </div>
      <RsForm :size="sizePreset" max-width="md">
        <RsInput v-model="sizeName" label="名称" :placeholder="`size: ${sizePreset}`" />
        <RsInput v-model="sizeEmail" label="邮箱" type="email" placeholder="you@example.com" />
      </RsForm>
    </DemoBlock>

    <DemoBlock title="间距 gap 与最大宽度 maxWidth">
      <div class="grid-compare">
        <div class="panel">
          <p class="panel-label">gap: sm · maxWidth: sm</p>
          <RsForm gap="sm" max-width="sm">
            <RsInput placeholder="字段 A" />
            <RsInput placeholder="字段 B" />
          </RsForm>
        </div>
        <div class="panel">
          <p class="panel-label">gap: lg · maxWidth: lg</p>
          <RsForm gap="lg" max-width="lg">
            <RsInput placeholder="字段 A" />
            <RsInput placeholder="字段 B" />
          </RsForm>
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="左侧标签布局">
      <p class="hint">
        <code>RsForm label-position="left"</code> + <code>RsInput label</code>，继承
        <code>label-width</code>。
      </p>
      <RsForm label-position="left" label-width="5rem" max-width="lg">
        <RsInput v-model="leftName" label="名称" placeholder="工作区名称" />
        <RsInput
          v-model="leftEmail"
          label="邮箱"
          type="email"
          rule="email"
          required
          placeholder="you@example.com"
        />
      </RsForm>
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
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.row--mb {
  margin-bottom: 0.75rem;
}
.result {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.result code {
  color: var(--rs-text);
}
.grid-compare {
  display: grid;
  gap: 1rem;
}
@media (min-width: 48rem) {
  .grid-compare {
    grid-template-columns: 1fr 1fr;
  }
}
.panel {
  padding: 0.75rem;
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}
.panel-label {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}
</style>
