<script setup lang="ts">
import { RsBadge } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
</script>

<template>
  <DemoPage title="RsBadge" test-file="RsBadge.spec.ts">
    <DemoBlock title="变体一览">
      <div class="row">
        <RsBadge>默认</RsBadge>
        <RsBadge variant="primary">主色</RsBadge>
        <RsBadge variant="success">成功</RsBadge>
        <RsBadge variant="warning">警告</RsBadge>
        <RsBadge variant="danger">错误</RsBadge>
        <RsBadge variant="info">信息</RsBadge>
      </div>
    </DemoBlock>

    <DemoBlock title="任务状态">
      <p class="hint">常见 SaaS 状态映射，用 container 浅底 + 深字，避免大面积高饱和色。</p>
      <div class="row">
        <RsBadge variant="info">待处理</RsBadge>
        <RsBadge variant="primary">进行中</RsBadge>
        <RsBadge variant="success">已完成</RsBadge>
        <RsBadge variant="warning">需关注</RsBadge>
        <RsBadge variant="danger">已失败</RsBadge>
        <RsBadge>已归档</RsBadge>
      </div>
    </DemoBlock>

    <DemoBlock title="行内嵌入标题">
      <div class="inline-demo">
        <h3 class="inline-title">
          小说续写
          <RsBadge variant="primary">Beta</RsBadge>
        </h3>
        <p class="inline-desc">
          当前套餐
          <RsBadge variant="success">Pro</RsBadge>
          ，剩余额度 12,000 tokens
        </p>
      </div>
    </DemoBlock>

    <DemoBlock title="长短文案">
      <div class="row">
        <RsBadge variant="success">ON</RsBadge>
        <RsBadge variant="default">OFF</RsBadge>
        <RsBadge variant="info">v2.4.1</RsBadge>
        <RsBadge variant="warning">即将到期</RsBadge>
        <RsBadge variant="danger">配额已用尽</RsBadge>
      </div>
    </DemoBlock>

    <DemoBlock title="列表行示例">
      <ul class="list">
        <li class="list-item">
          <span class="list-name">API 网关</span>
          <RsBadge variant="success">运行中</RsBadge>
        </li>
        <li class="list-item">
          <span class="list-name">向量检索</span>
          <RsBadge variant="warning">降级</RsBadge>
        </li>
        <li class="list-item">
          <span class="list-name">旧版 Webhook</span>
          <RsBadge variant="default">已停用</RsBadge>
        </li>
        <li class="list-item">
          <span class="list-name">支付回调</span>
          <RsBadge variant="danger">异常</RsBadge>
        </li>
      </ul>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.inline-demo {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.inline-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: var(--rs-font-size-md);
  font-weight: 600;
  color: var(--rs-text);
}
.inline-desc {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  overflow: hidden;
}
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  background: var(--rs-surface);
}
.list-item + .list-item {
  border-top: 1px solid var(--rs-border-subtle);
}
.list-name {
  font-weight: 500;
}
</style>
