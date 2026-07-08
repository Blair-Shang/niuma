<script setup lang="ts">
import { ref } from 'vue'
import {
  RsButton,
  RsForm,
  RsIcon,
  RsInput,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const search = ref('')
const email = ref('')
const password = ref('Ruoshui123')
const passwordHiddenToggle = ref('Ruoshui123')
const loginPassword = ref('')
const apiKey = ref('sk-ruoshui-demo')
const amount = ref('')
const phone = ref('')
const siteUrl = ref('')
const domain = ref('')
const age = ref('')
const bio = ref('')
const nickname = ref('弱水')
const inviteCode = ref('')
const leftEmail = ref('')
const leftSearch = ref('')
const pressEnterLog = ref('（按 Enter 触发）')
const validateOnInput = ref('')

function onPressEnter() {
  pressEnterLog.value = `Enter @ ${new Date().toLocaleTimeString()}`
}
</script>

<template>
  <DemoPage title="RsInput" test-file="RsInput.spec.ts">
    <DemoBlock title="推荐用法 · 内置 label">
      <p class="hint">
        表单字段优先使用 <code>label</code> / <code>hint</code> / <code>required</code>，无需再包
        <code>RsLabel</code>（Select 等仍可用 RsLabel）。
      </p>
      <RsInput v-model="search" label="搜索" type="search" clearable placeholder="搜索…" />
    </DemoBlock>

    <DemoBlock title="控制台 · 无 label（TopBar / CommandPalette）">
      <p class="hint">纯工具输入：prefix 插槽 + clearable，不占表单 label 位。</p>
      <RsInput v-model="search" clearable placeholder="搜索命令、页面…">
        <template #prefix>
          <RsIcon name="search" :size="16" />
        </template>
      </RsInput>
    </DemoBlock>

    <DemoBlock title="前缀 / 后缀 · addon 文本">
      <div class="stack">
        <RsInput v-model="amount" prefix="￥" suffix="CNY" placeholder="0.00" rule="number" />
        <RsInput v-model="domain" prefix="https://" placeholder="example.com" />
      </div>
    </DemoBlock>

    <DemoBlock title="clearable · showCount · readonly">
      <div class="stack">
        <RsInput v-model="nickname" label="昵称" clearable placeholder="输入后可清除" />
        <RsInput
          v-model="bio"
          label="简介"
          :maxlength="50"
          show-count
          clearable
          placeholder="最多 50 字"
        />
        <RsInput
          v-model="apiKey"
          label="API Key"
          readonly
          hint="只读态，可选中复制"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="密码 · visibilityToggle">
      <p class="hint">
        空值时 placeholder 不要用 <code>••••</code>，否则会和密文圆点混淆；显隐只作用于<strong>已输入</strong>的内容。
        下方示例预填了密码，便于直接点眼睛对比。
      </p>
      <div class="stack">
        <RsInput
          v-model="password"
          label="密码"
          hint="type=password 默认显示显隐按钮"
          type="password"
          rule="minComplexity"
          required
          placeholder="请输入密码"
        />
        <RsInput
          v-model="passwordHiddenToggle"
          label="隐藏显隐按钮"
          type="password"
          :visibility-toggle="false"
          placeholder="请输入密码"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="格式校验 · validateTrigger">
      <div class="form">
        <RsInput
          v-model="email"
          label="邮箱（blur）"
          rule="email"
          required
          validate-trigger="blur"
          placeholder="you@example.com"
        />
        <RsInput
          v-model="validateOnInput"
          label="实时校验（input）"
          required
          validate-trigger="input"
          placeholder="输入时校验必填"
        />
        <RsInput v-model="phone" label="手机号" rule="phone" type="tel" placeholder="13800000000" />
        <RsInput v-model="siteUrl" label="网站" rule="url" type="url" placeholder="https://ruoshui.app" />
        <RsInput v-model="age" label="年龄" rule="integer" placeholder="18" />
      </div>
    </DemoBlock>

    <DemoBlock title="自定义 validator · 手动 invalid">
      <div class="stack">
        <RsInput
          v-model="inviteCode"
          label="邀请码"
          placeholder="RUO-XXXX"
          :validator="(v) => /^RUO-[A-Z0-9]{4}$/.test(v) || '格式：RUO-XXXX'"
        />
        <RsInput
          label="邮箱"
          invalid
          error-message="该邮箱已被注册"
          model-value="taken@example.com"
          placeholder="you@example.com"
          required
        />
      </div>
    </DemoBlock>

    <DemoBlock title="pressEnter">
      <RsInput
        v-model="search"
        label="提交搜索"
        clearable
        placeholder="按 Enter…"
        @press-enter="onPressEnter"
      />
      <p class="log">{{ pressEnterLog }}</p>
    </DemoBlock>

    <DemoBlock title="尺寸 sm / md / lg">
      <div class="stack">
        <RsInput size="sm" placeholder="sm · 24px" />
        <RsInput size="md" placeholder="md · 32px（默认）" />
        <RsInput size="lg" placeholder="lg · 40px" />
      </div>
    </DemoBlock>

    <DemoBlock title="disabled">
      <RsInput v-model="apiKey" label="API Key" hint="整字段 disabled" disabled />
    </DemoBlock>

    <DemoBlock title="左标签 · 字段级 label-position">
      <RsInput
        v-model="leftSearch"
        label="搜索"
        label-position="left"
        clearable
        placeholder="不依赖 RsForm 的左标签"
      />
    </DemoBlock>

    <DemoBlock title="RsForm · 左标签 + labelWidth + 校验不错位">
      <RsForm label-position="left" label-width="5rem" max-width="lg" gap="md">
        <RsInput v-model="leftSearch" label="搜索" clearable placeholder="搜索…" />
        <RsInput
          v-model="leftEmail"
          label="邮箱"
          rule="email"
          required
          clearable
          placeholder="失焦校验，错误时 label 不跳动"
        />
      </RsForm>
    </DemoBlock>

    <DemoBlock title="业务场景 · 登录表单">
      <p class="hint">演示空密码登录：placeholder 用文案提示，不要用圆点占位。</p>
      <RsForm max-width="sm" gap="md" class="login-demo">
        <RsInput
          v-model="email"
          label="邮箱"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
        />
        <RsInput
          v-model="loginPassword"
          label="密码"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
        <RsButton variant="primary">登录</RsButton>
      </RsForm>
    </DemoBlock>

    <DemoBlock title="业务场景 · 设置弹窗字段">
      <RsForm max-width="md" gap="md">
        <RsInput
          v-model="nickname"
          label="名称"
          required
          clearable
          placeholder="Provider 名称"
        />
        <RsInput
          v-model="domain"
          label="Base URL"
          required
          placeholder="https://api.openai.com/v1"
        />
        <RsInput
          v-model="apiKey"
          label="API Key"
          type="password"
          placeholder="sk-... 或 env:MY_KEY"
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
.hint strong {
  color: var(--rs-text);
  font-weight: 600;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 20rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 20rem;
}
.log {
  margin: 0.5rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono, monospace);
}
.login-demo :deep(.rs-button) {
  align-self: flex-start;
}
</style>
