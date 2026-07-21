<script setup lang="ts">
import { ref } from 'vue'
import { RsCheckbox } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basic = ref(false)
const checked = ref(true)
const withLabel = ref(true)
const indeterminate = ref(false)
</script>

<template>
  <DemoPage title="RsCheckbox" test-file="RsCheckbox.spec.ts">
    <DemoBlock title="基础">
      <div class="row">
        <RsCheckbox v-model="basic" />
        <RsCheckbox v-model="checked" />
        <RsCheckbox :model-value="true" disabled />
      </div>
    </DemoBlock>

    <DemoBlock title="带文案">
      <RsCheckbox v-model="withLabel">启用自动提交</RsCheckbox>
    </DemoBlock>

    <DemoBlock title="尺寸">
      <div class="row">
        <RsCheckbox v-model="basic" size="sm">sm</RsCheckbox>
        <RsCheckbox v-model="basic" size="md">md</RsCheckbox>
        <RsCheckbox v-model="basic" size="lg">lg</RsCheckbox>
      </div>
    </DemoBlock>

    <DemoBlock title="半选">
      <p class="hint">用于表头「部分选中」等场景。</p>
      <RsCheckbox v-model="indeterminate" :indeterminate="!indeterminate">
        半选示例
      </RsCheckbox>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
.hint {
  margin: 0 0 0.75rem;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
</style>
