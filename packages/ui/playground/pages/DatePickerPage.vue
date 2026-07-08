<script setup lang="ts">
import { ref } from 'vue'
import { RsDatePicker, type RsDateRangeValue } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const single = ref('')
const preset = ref('2025-06-16')
const requiredDate = ref('')
const leftLabel = ref('2025-07-01')

const range = ref<RsDateRangeValue>({ start: '', end: '' })
const presetRange = ref<RsDateRangeValue>({ start: '2025-06-01', end: '2025-06-30' })
const reportRange = ref<RsDateRangeValue>({ start: '2025-01-01', end: '2025-03-31' })

const disabledSingle = ref('2025-06-16')
const disabledRange = ref<RsDateRangeValue>({ start: '2025-06-01', end: '2025-06-07' })
</script>

<template>
  <DemoPage title="RsDatePicker" test-file="RsDatePicker.spec.ts">
    <DemoBlock title="基础单选">
      <p class="hint">
        点击触发器打开月历面板，选中后点「确定」写入 <code>v-model</code>（<code>YYYY-MM-DD</code>）。
      </p>
      <RsDatePicker v-model="single" label="选择日期" />
      <p class="value">当前值：<code>{{ single || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="预选回显">
      <p class="hint">触发器展示本地化日期文案，打开面板后回显已选日期。</p>
      <RsDatePicker v-model="preset" label="发布日期" hint="用于编辑场景回显" />
      <p class="value">当前值：<code>{{ preset }}</code></p>
    </DemoBlock>

    <DemoBlock title="必填标识">
      <RsDatePicker
        v-model="requiredDate"
        label="生效日期"
        hint="提交前需选择"
        required
      />
      <p class="value">当前值：<code>{{ requiredDate || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="标签左侧布局（labelPosition=left）">
      <RsDatePicker
        v-model="leftLabel"
        label="账期截止"
        label-position="left"
        hint="与左侧标签基线对齐"
      />
      <p class="value">当前值：<code>{{ leftLabel }}</code></p>
    </DemoBlock>

    <DemoBlock title="单框日期范围（range）">
      <p class="hint">
        <code>range</code> 模式下触发器为<strong>一个输入框</strong>，面板内左右双月历分别选择起止日期。
      </p>
      <RsDatePicker v-model="range" label="统计区间" range />
      <p class="value">
        当前值：
        <code>{{ range.start || '—' }}</code>
        ~
        <code>{{ range.end || '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="范围预选回显">
      <RsDatePicker
        v-model="presetRange"
        label="活动周期"
        range
        hint="六月整月活动"
      />
      <p class="value">
        当前值：<code>{{ presetRange.start }}</code> ~ <code>{{ presetRange.end }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="禁用态">
      <div class="stack">
        <RsDatePicker v-model="disabledSingle" label="单选（禁用）" disabled />
        <RsDatePicker v-model="disabledRange" label="范围（禁用）" range disabled />
      </div>
    </DemoBlock>

    <DemoBlock title="组合示例：报表筛选">
      <div class="filter-panel">
        <RsDatePicker
          v-model="reportRange"
          label="报表周期"
          label-position="left"
          range
          hint="按自然日筛选导出数据"
        />
        <p class="filter-summary">
          将导出
          <strong>{{ reportRange.start || '—' }}</strong>
          至
          <strong>{{ reportRange.end || '—' }}</strong>
          的数据
        </p>
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
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.value {
  margin: 0.5rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.value code {
  font-size: inherit;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.filter-panel {
  max-width: 28rem;
  padding: 1rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
}
.filter-summary {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.filter-summary strong {
  color: var(--rs-text);
  font-weight: 600;
}
</style>
