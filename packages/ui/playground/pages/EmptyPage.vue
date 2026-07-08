<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'
</script>

<template>
  <DemoPage title="RsEmpty" test-file="RsEmpty.spec.ts">
    <DemoBlock title="仅描述">
      <p class="hint">
        <code>description</code> 为必填，由业务方传入文案；组件不内置 i18n。
      </p>
      <RsEmpty description="暂无数据，稍后再来看看。" />
    </DemoBlock>

    <DemoBlock title="标题 + 描述">
      <RsEmpty
        title="还没有项目"
        description="创建第一个项目，开始协作与发布流程。"
      />
    </DemoBlock>

    <DemoBlock title="自定义图标">
      <p class="hint">通过 <code>#icon</code> 插槽替换默认图标区，常用 <code>RsIcon</code>。</p>
      <div class="stack">
        <RsEmpty description="收件箱是空的，新消息会出现在这里。">
          <template #icon>
            <RsIcon name="inbox" :size="22" label="空收件箱" />
          </template>
        </RsEmpty>
        <RsEmpty title="未找到结果" description="尝试更换关键词或清除筛选条件。">
          <template #icon>
            <RsIcon name="search-x" :size="22" label="无搜索结果" />
          </template>
        </RsEmpty>
        <RsEmpty title="文件夹为空" description="拖拽文件到此处，或点击上传。">
          <template #icon>
            <RsIcon name="folder-open" :size="22" label="空文件夹" />
          </template>
        </RsEmpty>
      </div>
    </DemoBlock>

    <DemoBlock title="操作区（默认插槽）">
      <p class="hint">主操作、次要操作放在默认插槽，通常配合 <code>RsButton</code>。</p>
      <RsEmpty
        title="暂无团队成员"
        description="邀请同事加入工作区，一起编辑与评审。"
      >
        <template #icon>
          <RsIcon name="users" :size="22" label="无成员" />
        </template>
        <div class="actions">
          <RsButton variant="default">了解权限</RsButton>
          <RsButton>邀请成员</RsButton>
        </div>
      </RsEmpty>
    </DemoBlock>

    <DemoBlock title="业务场景示例">
      <div class="stack">
        <div class="panel">
          <p class="panel-label">列表空态</p>
          <RsEmpty description="当前分类下没有任务。">
            <template #icon>
              <RsIcon name="list-todo" :size="22" label="空列表" />
            </template>
            <RsButton size="sm">新建任务</RsButton>
          </RsEmpty>
        </div>
        <div class="panel">
          <p class="panel-label">搜索无结果</p>
          <RsEmpty
            title="没有匹配「design system」的内容"
            description="检查拼写，或浏览全部文档。"
          >
            <template #icon>
              <RsIcon name="file-search" :size="22" label="无文档" />
            </template>
          </RsEmpty>
        </div>
        <div class="panel">
          <p class="panel-label">错误 / 离线（仅文案区分语义）</p>
          <RsEmpty
            title="加载失败"
            description="网络不稳定，请稍后重试。"
          >
            <template #icon>
              <RsIcon name="cloud-off" :size="22" label="离线" />
            </template>
            <RsButton size="sm" variant="default">返回</RsButton>
            <RsButton size="sm">重试</RsButton>
          </RsEmpty>
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
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}
.panel {
  padding: 0.75rem;
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}
.panel-label {
  margin: 0 0 0.5rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-muted);
}
</style>
