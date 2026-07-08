<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsDrawer } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const basicOpen = ref(false)
const descOpen = ref(false)

const sideOpen = ref(false)
const sidePreset = ref<'left' | 'right' | 'top' | 'bottom'>('right')

const sizeOpen = ref(false)
const sizePreset = ref<'sm' | 'md' | 'lg' | 'full'>('md')

const footerOpen = ref(false)

const overlayCloseOpen = ref(false)
const noOverlayCloseOpen = ref(false)
const noOverlayOpen = ref(false)
const noCloseOpen = ref(false)

const headerSlotOpen = ref(false)
</script>

<template>
  <DemoPage title="RsDrawer" test-file="RsDrawer.spec.ts">
    <DemoBlock title="右侧抽屉（默认）">
      <p class="hint">
        默认 <code>side="right"</code>、<code>size="md"</code>；通过
        <code>v-model:open</code> 控制显隐，适合筛选面板、详情侧栏。
      </p>
      <RsButton @click="basicOpen = true">打开抽屉</RsButton>
      <RsDrawer v-model:open="basicOpen" title="筛选条件">
        <p class="body-text">在此放置表单、列表或操作说明，body 区域可滚动。</p>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="标题与描述">
      <RsButton variant="default" @click="descOpen = true">成员详情</RsButton>
      <RsDrawer
        v-model:open="descOpen"
        title="Alice Chen"
        description="产品设计师 · 加入于 2024-03"
      >
        <p class="body-text">个人简介、权限与活动记录可放在 body 中。</p>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="滑出方向 side">
      <p class="hint"><code>left</code> / <code>right</code> / <code>top</code> / <code>bottom</code> 四向侧滑。</p>
      <div class="row">
        <RsButton
          v-for="side in (['left', 'right', 'top', 'bottom'] as const)"
          :key="side"
          size="sm"
          variant="default"
          @click="sidePreset = side; sideOpen = true"
        >
          {{ side }}
        </RsButton>
      </div>
      <RsDrawer
        v-model:open="sideOpen"
        :side="sidePreset"
        :title="`side: ${sidePreset}`"
        description="观察抽屉从对应边缘滑入。"
      >
        <p class="body-text">当前方向：<code>{{ sidePreset }}</code></p>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="尺寸 size">
      <p class="hint">
        水平抽屉控制宽度，垂直抽屉控制高度；<code>full</code> 占满视口对应轴向。
      </p>
      <div class="row">
        <RsButton
          v-for="size in (['sm', 'md', 'lg', 'full'] as const)"
          :key="size"
          size="sm"
          variant="default"
          @click="sizePreset = size; sizeOpen = true"
        >
          {{ size }}
        </RsButton>
      </div>
      <RsDrawer
        v-model:open="sizeOpen"
        :size="sizePreset"
        title="通知中心"
        :description="`size: ${sizePreset}`"
      >
        <p class="body-text">调整 size 观察抽屉占位变化。</p>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="footer 插槽">
      <RsButton @click="footerOpen = true">编辑资料</RsButton>
      <RsDrawer v-model:open="footerOpen" title="个人资料" description="更新头像与显示名称。">
        <p class="body-text">表单字段放在 body，底部操作走 footer。</p>
        <template #footer>
          <RsButton variant="default" @click="footerOpen = false">取消</RsButton>
          <RsButton @click="footerOpen = false">保存</RsButton>
        </template>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="点击遮罩关闭">
      <p class="hint">
        默认 <code>close-on-overlay-click</code> 为 <code>true</code>；设为
        <code>false</code> 时需通过按钮或业务逻辑关闭。
      </p>
      <div class="row">
        <RsButton variant="default" @click="overlayCloseOpen = true">默认可点遮罩关闭</RsButton>
        <RsButton variant="default" @click="noOverlayCloseOpen = true">禁止点遮罩关闭</RsButton>
      </div>
      <RsDrawer
        v-model:open="overlayCloseOpen"
        title="快捷预览"
        description="点击遮罩即可关闭。"
      >
        <p class="body-text">适合轻量预览场景。</p>
      </RsDrawer>
      <RsDrawer
        v-model:open="noOverlayCloseOpen"
        title="未保存的更改"
        :close-on-overlay-click="false"
        description="必须明确选择操作。"
      >
        <p class="body-text">防止误触遮罩导致数据丢失。</p>
        <template #footer>
          <RsButton variant="default" @click="noOverlayCloseOpen = false">放弃</RsButton>
          <RsButton @click="noOverlayCloseOpen = false">保存并关闭</RsButton>
        </template>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="无遮罩 / 无关闭按钮">
      <p class="hint">
        <code>show-overlay</code> 与 <code>show-close</code> 可独立配置；关闭按钮 tooltip 随
        Playground 语言切换（<code>t('dialog.close')</code>）。
      </p>
      <div class="row">
        <RsButton size="sm" variant="default" @click="noOverlayOpen = true">无遮罩</RsButton>
        <RsButton size="sm" variant="default" @click="noCloseOpen = true">无关闭按钮</RsButton>
      </div>
      <RsDrawer v-model:open="noOverlayOpen" title="嵌入式面板" :show-overlay="false">
        <p class="body-text">背景页面仍可交互，适合分栏内嵌场景。</p>
        <template #footer>
          <RsButton @click="noOverlayOpen = false">完成</RsButton>
        </template>
      </RsDrawer>
      <RsDrawer v-model:open="noCloseOpen" title="引导流程" :show-close="false">
        <p class="body-text">用户需完成步骤后通过 footer 关闭。</p>
        <template #footer>
          <RsButton @click="noCloseOpen = false">下一步</RsButton>
        </template>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="自定义 header 插槽">
      <RsButton @click="headerSlotOpen = true">打开</RsButton>
      <RsDrawer v-model:open="headerSlotOpen">
        <template #header>
          <div class="custom-header">
            <span class="custom-header__badge">Pro</span>
            <h3 class="custom-header__title">升级方案</h3>
            <p class="custom-header__desc">完全接管 header，适合 Tab 或步骤条。</p>
          </div>
        </template>
        <p class="body-text">使用 header 插槽时 title / description props 被插槽内容替代。</p>
        <template #footer>
          <RsButton variant="default" @click="headerSlotOpen = false">稍后再说</RsButton>
          <RsButton @click="headerSlotOpen = false">立即升级</RsButton>
        </template>
      </RsDrawer>
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
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.body-text {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  line-height: var(--rs-line-height-normal);
}
.custom-header__badge {
  display: inline-block;
  margin-bottom: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
}
.custom-header__title {
  margin: 0;
  font-size: var(--rs-font-size-base);
  font-weight: 600;
  color: var(--rs-text);
}
.custom-header__desc {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
</style>
