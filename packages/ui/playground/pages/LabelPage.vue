<script setup lang="ts">
import { ref } from 'vue'
import { RsInput, RsLabel } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const email = ref('')
const username = ref('')
const bio = ref('')
</script>

<template>
  <DemoPage title="RsLabel" test-file="RsLabel.spec.ts">
    <DemoBlock title="与 RsInput 内置 label 对比">
      <p class="hint">
        新表单优先用 <code>RsInput label</code>；本页演示 <code>RsLabel</code> 独立用法（Select、自定义排版）。
      </p>
    </DemoBlock>

    <DemoBlock title="基础标签">
      <p class="hint">仅展示字段名，无 for 关联时可作纯文案标签。</p>
      <RsLabel>显示名称</RsLabel>
    </DemoBlock>

    <DemoBlock title="关联输入框（for-id）">
      <p class="hint">点击标签应聚焦下方输入框。</p>
      <div class="field">
        <RsLabel for-id="pg-name">用户名</RsLabel>
        <RsInput id="pg-name" v-model="username" placeholder="弱水用户" />
      </div>
    </DemoBlock>

    <DemoBlock title="必填（required）">
      <div class="field">
        <RsLabel for-id="pg-required" required>邮箱地址</RsLabel>
        <RsInput id="pg-required" v-model="email" type="email" placeholder="you@example.com" />
      </div>
    </DemoBlock>

    <DemoBlock title="辅助说明（hint）">
      <div class="field">
        <RsLabel for-id="pg-hint" hint="将展示在个人资料页，可随时修改">
          个人简介
        </RsLabel>
        <RsInput id="pg-hint" v-model="bio" placeholder="一句话介绍自己" />
      </div>
    </DemoBlock>

    <DemoBlock title="必填 + 提示（完整表单字段）">
      <div class="field">
        <RsLabel for-id="pg-email" required hint="用于登录与通知">
          邮箱地址
        </RsLabel>
        <RsInput id="pg-email" v-model="email" type="email" placeholder="you@example.com" />
      </div>
    </DemoBlock>

    <DemoBlock title="禁用态（disabled）">
      <p class="hint">整项不可编辑时，标签与输入框一并禁用。</p>
      <div class="field">
        <RsLabel for-id="pg-disabled" required hint="当前账号不可修改" disabled>
          组织 ID
        </RsLabel>
        <RsInput id="pg-disabled" disabled value="org-ruoshui-001" />
      </div>
    </DemoBlock>

    <DemoBlock title="表单组合示例">
      <div class="form">
        <div class="field">
          <RsLabel for-id="pg-form-name" required>姓名</RsLabel>
          <RsInput id="pg-form-name" placeholder="张三" />
        </div>
        <div class="field">
          <RsLabel for-id="pg-form-phone" hint="选填，用于找回密码">手机号</RsLabel>
          <RsInput id="pg-form-phone" type="text" placeholder="13800000000" />
        </div>
        <div class="field">
          <RsLabel for-id="pg-form-pwd" required hint="至少 8 位，含字母与数字">密码</RsLabel>
          <RsInput id="pg-form-pwd" type="password" placeholder="请输入密码" />
        </div>
      </div>
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
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 20rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-width: 20rem;
}
</style>
