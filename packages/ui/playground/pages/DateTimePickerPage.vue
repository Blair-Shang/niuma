<script setup lang="ts">
import { ref } from 'vue'
import { RsDateTimePicker } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

type DateTimeRange = { start?: string; end?: string }

const single = ref('')
const preset = ref('2025-06-16 14:30:00')
const requiredDateTime = ref('')
const leftLabel = ref('2025-07-01 09:00:00')

const range = ref<DateTimeRange>({ start: '', end: '' })
const presetRange = ref<DateTimeRange>({
  start: '2025-06-01 09:00:00',
  end: '2025-06-30 18:00:00',
})
const withSeconds = ref('2025-06-16 14:30:45')

const disabledSingle = ref('2025-06-16 10:00:00')
const disabledRange = ref<DateTimeRange>({
  start: '2025-06-01 08:00:00',
  end: '2025-06-07 20:00:00',
})

const scheduleStart = ref('2025-06-20 09:00:00')
const scheduleEnd = ref('2025-06-20 18:00:00')
</script>

<template>
  <DemoPage title="RsDateTimePicker" test-file="RsDateTimePicker.spec.ts">
    <DemoBlock title="基础单选">
      <p class="hint">
        点击触发器打开月历 + 时间列表面板，选中后点「确定」写入
        <code>v-model</code>（<code>YYYY-MM-DD HH:mm:ss</code>）。
      </p>
      <RsDateTimePicker v-model="single" label="开始时间" />
      <p class="value">当前值：<code>{{ single || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="预选回显">
      <RsDateTimePicker
        v-model="preset"
        label="发布时间"
        hint="编辑场景回显已选日期时间"
      />
      <p class="value">当前值：<code>{{ preset }}</code></p>
    </DemoBlock>

    <DemoBlock title="必填与提示">
      <RsDateTimePicker
        v-model="requiredDateTime"
        label="截止时间"
        hint="提交前需填写"
        required
      />
      <p class="value">当前值：<code>{{ requiredDateTime || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="标签左侧布局（labelPosition=left）">
      <RsDateTimePicker
        v-model="leftLabel"
        label="会议开始"
        label-position="left"
        hint="与左侧标签基线对齐"
      />
      <p class="value">当前值：<code>{{ leftLabel }}</code></p>
    </DemoBlock>

    <DemoBlock title="日期时间范围（range）">
      <p class="hint">
        <code>range</code> 模式下触发器为<strong>一个输入框</strong>，面板内左右双月历各带时间选择。
      </p>
      <RsDateTimePicker v-model="range" label="活动时段" range />
      <p class="value">
        当前值：
        <code>{{ range.start || '—' }}</code>
        ~
        <code>{{ range.end || '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="范围预选回显">
      <RsDateTimePicker
        v-model="presetRange"
        label="六月活动"
        range
        hint="整月营业时段"
      />
      <p class="value">
        当前值：<code>{{ presetRange.start }}</code> ~ <code>{{ presetRange.end }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="秒精度 withSeconds">
      <p class="hint"><code>with-seconds</code> 开启秒级时间列。</p>
      <RsDateTimePicker v-model="withSeconds" label="精确到秒" with-seconds />
      <p class="value">当前值：<code>{{ withSeconds }}</code></p>
    </DemoBlock>

    <DemoBlock title="禁用态">
      <div class="stack">
        <RsDateTimePicker v-model="disabledSingle" label="单选（禁用）" disabled />
        <RsDateTimePicker v-model="disabledRange" label="范围（禁用）" range disabled />
      </div>
    </DemoBlock>

    <DemoBlock title="组合示例：排期表单">
      <div class="schedule-panel">
        <RsDateTimePicker
          v-model="scheduleStart"
          label="开始"
          label-position="left"
          required
        />
        <RsDateTimePicker
          v-model="scheduleEnd"
          label="结束"
          label-position="left"
          required
          hint="须晚于开始时间"
        />
        <p class="schedule-summary">
          排期：
          <strong>{{ scheduleStart || '—' }}</strong>
          至
          <strong>{{ scheduleEnd || '—' }}</strong>
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
.schedule-panel {
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
}
.schedule-summary {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.schedule-summary strong {
  color: var(--rs-text);
  font-weight: 600;
}
</style>
