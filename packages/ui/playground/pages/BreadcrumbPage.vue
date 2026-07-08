<script setup lang="ts">
import { ref } from 'vue'
import { RsBreadcrumb, RsButton, type RsBreadcrumbItem } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const dynamicItems = ref<RsBreadcrumbItem[]>([
  { label: '控制台', href: '#' },
  { label: '弱水 AI', href: '#' },
  { label: '应用详情' },
])

const depthLabels = ['控制台', '弱水 AI', '应用广场', '小说续写', '章节编辑', '段落润色']

function deepenPath() {
  if (dynamicItems.value.length >= depthLabels.length) return
  const next = depthLabels[dynamicItems.value.length]
  const prev = dynamicItems.value.at(-1)
  if (prev && !prev.href && !prev.to) {
    dynamicItems.value[dynamicItems.value.length - 1] = { ...prev, href: '#' }
  }
  dynamicItems.value = [...dynamicItems.value, { label: next }]
}

function shallowPath() {
  if (dynamicItems.value.length <= 1) return
  dynamicItems.value = dynamicItems.value.slice(0, -1)
}

function resetPath() {
  dynamicItems.value = [
    { label: '控制台', href: '#' },
    { label: '弱水 AI', href: '#' },
    { label: '应用详情' },
  ]
}
</script>

<template>
  <DemoPage title="RsBreadcrumb" test-file="RsBreadcrumb.spec.ts">
    <DemoBlock title="三级路径（SaaS 详情页）">
      <p class="hint">常见后台详情页：前两级可点击，末级为当前页（加粗、不可点）。</p>
      <RsBreadcrumb
        :items="[
          { label: '首页', href: '#' },
          { label: '应用广场', href: '#' },
          { label: '小说续写' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="单一项">
      <p class="hint">仅当前页时不渲染分隔符。</p>
      <RsBreadcrumb :items="[{ label: '仪表盘' }]" />
    </DemoBlock>

    <DemoBlock title="空列表">
      <p class="hint">items 为空时保留 nav 结构，不渲染任何层级。</p>
      <RsBreadcrumb :items="[]" />
      <p class="meta">（上方区域应为空白）</p>
    </DemoBlock>

    <DemoBlock title="href 外链">
      <p class="hint">带 href 的项渲染为 &lt;a&gt;，末级无 href 时为当前页。</p>
      <RsBreadcrumb
        :items="[
          { label: '文档中心', href: 'https://lucide.dev' },
          { label: '组件', href: 'https://lucide.dev/icons/' },
          { label: 'Breadcrumb' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="to 路由占位">
      <p class="hint">
        仅传 to 时也会渲染为 &lt;a&gt;（便于与 Vue Router 等集成）；实际跳转需业务侧包装。
      </p>
      <RsBreadcrumb
        :items="[
          { label: '工作区', to: '/workspace' },
          { label: '项目设置', to: '/workspace/settings' },
          { label: '成员管理' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="to + href 同时存在">
      <p class="hint">同时提供时以 href 作为锚点地址（与单测一致）。</p>
      <RsBreadcrumb
        :items="[
          { label: '入口', to: '/route-target', href: '/href-target' },
          { label: '当前页' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="纯文本层级">
      <p class="hint">无 href / to 时全部为 &lt;span&gt;，适合只读展示。</p>
      <RsBreadcrumb
        :items="[
          { label: '华北区' },
          { label: '北京' },
          { label: '朝阳区' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="五层深路径">
      <RsBreadcrumb
        :items="[
          { label: '组织', href: '#' },
          { label: '团队', href: '#' },
          { label: '项目', href: '#' },
          { label: '迭代', href: '#' },
          { label: '任务 #1284' },
        ]"
      />
    </DemoBlock>

    <DemoBlock title="长标签换行">
      <p class="hint">窄容器下 flex-wrap 自动折行，分隔符仍夹在相邻项之间。</p>
      <div class="narrow">
        <RsBreadcrumb
          :items="[
            { label: '企业级多租户 SaaS 控制台', href: '#' },
            { label: '国际化与无障碍设计规范', href: '#' },
            { label: '面包屑导航组件 Playground 演示页' },
          ]"
        />
      </div>
    </DemoBlock>

    <DemoBlock title="动态增删层级">
      <p class="hint">模拟路由深度变化：加深时把上一级变为可点击，新末级为当前页。</p>
      <div class="dynamic">
        <RsBreadcrumb :items="dynamicItems" />
        <div class="actions">
          <RsButton size="sm" variant="default" @click="shallowPath">减少一级</RsButton>
          <RsButton size="sm" variant="default" @click="deepenPath">增加一级</RsButton>
          <RsButton size="sm" variant="ghost" @click="resetPath">重置</RsButton>
        </div>
        <p class="meta">当前层级：{{ dynamicItems.length }}</p>
      </div>
    </DemoBlock>

    <DemoBlock title="页面顶栏组合">
      <p class="hint">嵌入页头时的典型布局：标题 + 面包屑。</p>
      <header class="page-header">
        <div class="page-header__main">
          <h1 class="page-header__title">小说续写</h1>
          <p class="page-header__desc">基于大模型的章节续写与润色</p>
        </div>
        <RsBreadcrumb
          :items="[
            { label: '首页', href: '#' },
            { label: '应用广场', href: '#' },
            { label: '小说续写' },
          ]"
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
.meta {
  margin: 0.5rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.narrow {
  max-width: 16rem;
  padding: 0.75rem;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}
.dynamic {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
}
.page-header__main {
  min-width: 0;
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
</style>
