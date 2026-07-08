<script setup lang="ts">
import { ref } from 'vue'
import { RsBadge, RsButton, RsStatCard } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const metricsLoading = ref(false)

function simulateMetricsLoad() {
  metricsLoading.value = true
  globalThis.setTimeout(() => {
    metricsLoading.value = false
  }, 1500)
}
</script>

<template>
  <DemoPage title="RsStatCard" test-file="RsStatCard.spec.ts">
    <DemoBlock title="基础用法">
      <p class="hint">展示指标标签与数值，顶部色条默认使用 primary 强调色。</p>
      <RsStatCard label="今日调用" :value="12480" />
    </DemoBlock>

    <DemoBlock title="accent 强调色">
      <p class="hint">顶部色条映射功能色 token，适合区分指标语义。</p>
      <div class="grid">
        <RsStatCard label="默认 primary" :value="128" accent="primary" />
        <RsStatCard label="运行中" :value="12" accent="success" />
        <RsStatCard label="待处理" :value="5" accent="warning" />
        <RsStatCard label="失败任务" :value="2" accent="danger" />
        <RsStatCard label="排队中" :value="8" accent="info" />
      </div>
    </DemoBlock>

    <DemoBlock title="描述文案">
      <RsStatCard
        label="错误率"
        value="0.12%"
        accent="warning"
        description="过去 24 小时，较昨日下降 0.03%"
      />
    </DemoBlock>

    <DemoBlock title="loading 骨架态">
      <p class="hint">数据拉取中隐藏数值，展示占位条；适合仪表盘异步指标。</p>
      <div class="row">
        <RsButton size="sm" @click="simulateMetricsLoad">模拟加载 1.5s</RsButton>
      </div>
      <div class="grid">
        <RsStatCard label="活跃用户" :value="3842" accent="primary" :loading="metricsLoading" />
        <RsStatCard
          label="API 成功率"
          value="99.97%"
          accent="success"
          description="近 7 天均值"
          :loading="metricsLoading"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="value 插槽">
      <p class="hint">自定义数值区排版，如带单位、趋势或格式化展示。</p>
      <RsStatCard label="月度营收" accent="success">
        <template #value>
          <span class="value-with-unit">¥ 128.4<small>万</small></span>
        </template>
      </RsStatCard>
    </DemoBlock>

    <DemoBlock title="默认插槽">
      <RsStatCard label="存储用量" value="68%" accent="info" description="已用 34 GB / 50 GB">
        <div class="usage-bar">
          <div class="usage-bar__fill" style="width: 68%" />
        </div>
      </RsStatCard>
    </DemoBlock>

    <DemoBlock title="仪表盘组合">
      <p class="hint">多卡片网格排列，常见于 SaaS 概览页 KPI 区。</p>
      <div class="grid">
        <RsStatCard label="今日调用" :value="12480" description="较昨日 +8.2%" />
        <RsStatCard label="错误率" value="0.12%" accent="warning" description="过去 24 小时" />
        <RsStatCard label="运行中任务" :value="12" accent="success">
          <div class="card-footer">
            <RsBadge variant="success">正常</RsBadge>
          </div>
        </RsStatCard>
        <RsStatCard label="失败任务" :value="2" accent="danger" description="需人工介入">
          <div class="card-footer">
            <RsButton size="sm" variant="ghost">查看详情</RsButton>
          </div>
        </RsStatCard>
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.75rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.value-with-unit {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--rs-text);
}
.value-with-unit small {
  margin-left: 0.125rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--rs-muted);
}
.usage-bar {
  height: 0.375rem;
  margin-top: var(--rs-space-sm);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
  overflow: hidden;
}
.usage-bar__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--rs-info);
}
.card-footer {
  display: flex;
  align-items: center;
  margin-top: var(--rs-space-sm);
}
</style>
