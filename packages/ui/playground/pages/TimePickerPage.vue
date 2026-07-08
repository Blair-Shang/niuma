<script setup lang="ts">
import { ref } from 'vue'
import { RsTimePicker, type RsTimeRangeValue } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const single = ref('')
const preset = ref('14:30')
const requiredTime = ref('')
const leftLabel = ref('09:00')

const range = ref<RsTimeRangeValue>({ start: '', end: '' })
const presetRange = ref<RsTimeRangeValue>({ start: '09:00', end: '18:00' })
const shiftRange = ref<RsTimeRangeValue>({ start: '08:30', end: '17:30' })

const withSeconds = ref('14:30:45')
const disabledSingle = ref('10:00')
const disabledRange = ref<RsTimeRangeValue>({ start: '08:00', end: '20:00' })
</script>

<template>
  <DemoPage title="RsTimePicker" test-file="RsTimePicker.spec.ts">
    <DemoBlock title="基础单选">
      <p class="hint">
        点击触发器打开时分滚动列面板，选中后点「确定」写入 <code>v-model</code>（<code>HH:mm</code>）。
      </p>
      <RsTimePicker v-model="single" label="上班时间" />
      <p class="value">当前值：<code>{{ single || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="预选回显">
      <RsTimePicker v-model="preset" label="会议时间" hint="编辑场景回显已选时间" />
      <p class="value">当前值：<code>{{ preset }}</code></p>
    </DemoBlock>

    <DemoBlock title="必填标识">
      <RsTimePicker
        v-model="requiredTime"
        label="签到时间"
        hint="提交前需选择"
        required
      />
      <p class="value">当前值：<code>{{ requiredTime || '（空）' }}</code></p>
    </DemoBlock>

    <DemoBlock title="标签左侧布局（labelPosition=left）">
      <RsTimePicker
        v-model="leftLabel"
        label="开门时间"
        label-position="left"
        hint="与左侧标签基线对齐"
      />
      <p class="value">当前值：<code>{{ leftLabel }}</code></p>
    </DemoBlock>

    <DemoBlock title="单框时间范围（range）">
      <p class="hint">
        <code>range</code> 模式下触发器为<strong>一个输入框</strong>，面板内左右分别选择起止时间。
      </p>
      <RsTimePicker v-model="range" label="营业时段" range />
      <p class="value">
        当前值：
        <code>{{ range.start || '—' }}</code>
        ~
        <code>{{ range.end || '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="范围预选回显">
      <RsTimePicker
        v-model="presetRange"
        label="工作日"
        range
        hint="朝九晚六"
      />
      <p class="value">
        当前值：<code>{{ presetRange.start }}</code> ~ <code>{{ presetRange.end }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="精确到秒（withSeconds）">
      <RsTimePicker
        v-model="withSeconds"
        label="打卡时间"
        with-seconds
        hint="开启 withSeconds 后格式为 HH:mm:ss"
      />
      <p class="value">当前值：<code>{{ withSeconds }}</code></p>
    </DemoBlock>

    <DemoBlock title="禁用态">
      <div class="stack">
        <RsTimePicker v-model="disabledSingle" label="单选（禁用）" disabled />
        <RsTimePicker v-model="disabledRange" label="范围（禁用）" range disabled />
      </div>
    </DemoBlock>

    <DemoBlock title="组合示例：排班筛选">
      <div class="filter-panel">
        <RsTimePicker
          v-model="shiftRange"
          label="班次时段"
          label-position="left"
          range
          hint="筛选该时段内的排班记录"
        />
        <p class="filter-summary">
          将筛选
          <strong>{{ shiftRange.start || '—' }}</strong>
          至
          <strong>{{ shiftRange.end || '—' }}</strong>
          的排班
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
