<script setup lang="ts">
import { ref } from 'vue'
import { RsButton, RsIcon, RsTooltip, RsTooltipProvider } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const align = ref<'start' | 'center' | 'end'>('center')
const sideOffset = ref(6)
const tooltipDisabled = ref(false)
const providerDelay = ref(300)

const sides = ['top', 'right', 'bottom', 'left'] as const
const aligns = ['start', 'center', 'end'] as const
</script>

<template>
  <DemoPage title="RsTooltip" test-file="RsTooltip.spec.ts">
    <RsTooltipProvider :delay-duration="providerDelay">
      <DemoBlock title="基础用法">
        <p class="hint">
          默认插槽为触发器，悬停显示提示；文案可通过 <code>content</code> 或
          <code>#content</code> 插槽传入。页面需包裹 <code>RsTooltipProvider</code>。
        </p>
        <RsTooltip content="保存当前编辑内容">
          <RsButton variant="default">悬停查看提示</RsButton>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="自定义内容 #content">
        <p class="hint">插槽可承载多行说明或带格式的提示，不限于纯文本。</p>
        <RsTooltip side="bottom">
          <RsButton variant="ghost" size="sm">版本信息</RsButton>
          <template #content>
            <div class="tooltip-rich">
              <p class="tooltip-rich__title">弱水 UI v0.1</p>
              <p class="tooltip-rich__desc">基于 Reka UI，遵循 --rs-* 设计 token。</p>
            </div>
          </template>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="弹出方位 side">
        <p class="hint">在容器四角附近切换 <code>side</code>，观察提示相对触发器的位置。</p>
        <div class="placement-grid">
          <RsTooltip
            v-for="s in sides"
            :key="s"
            :side="s"
            :content="`side: ${s}`"
          >
            <RsButton size="sm" variant="default">{{ s }}</RsButton>
          </RsTooltip>
        </div>
      </DemoBlock>

      <DemoBlock title="对齐方式 align">
        <p class="hint">固定 <code>side=&quot;bottom&quot;</code>，切换 <code>align</code> 观察水平对齐。</p>
        <div class="row">
          <RsButton
            v-for="a in aligns"
            :key="a"
            size="sm"
            :variant="align === a ? 'primary' : 'default'"
            @click="align = a"
          >
            {{ a }}
          </RsButton>
        </div>
        <RsTooltip side="bottom" :align="align" :content="`align: ${align}`">
          <RsButton variant="default">对齐演示</RsButton>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="间距 sideOffset">
        <p class="hint"><code>side-offset</code> 控制提示与触发器之间的距离（默认 6px）。</p>
        <div class="row">
          <label class="offset-label">
            offset
            <input v-model.number="sideOffset" type="range" min="0" max="32" step="2" />
            <code>{{ sideOffset }}px</code>
          </label>
        </div>
        <RsTooltip side="top" :side-offset="sideOffset" :content="`offset: ${sideOffset}px`">
          <RsButton variant="default">间距演示</RsButton>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="禁用 disabled">
        <p class="hint"><code>disabled</code> 为 true 时不展示提示，适合无说明或触发器本身已禁用时。</p>
        <div class="row">
          <label class="toggle-label">
            <input v-model="tooltipDisabled" type="checkbox" />
            禁用 Tooltip
          </label>
        </div>
        <RsTooltip content="这条提示不会出现" :disabled="tooltipDisabled">
          <RsButton variant="default">悬停我</RsButton>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="Provider 延迟 delayDuration">
        <p class="hint">
          <code>RsTooltipProvider</code> 的 <code>delay-duration</code> 控制首次悬停延迟（毫秒）。
        </p>
        <div class="row">
          <label class="offset-label">
            delay
            <input v-model.number="providerDelay" type="range" min="0" max="800" step="100" />
            <code>{{ providerDelay }}ms</code>
          </label>
        </div>
        <RsTooltip content="注意悬停后的出现时机">
          <RsButton size="sm" variant="default">延迟演示</RsButton>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="场景：图标按钮说明">
        <p class="hint">工具栏图标按钮常配合 Tooltip 补充操作含义，触发器使用 <code>as-child</code> 透传。</p>
        <div class="toolbar">
          <RsTooltip content="新建文档">
            <button type="button" class="icon-btn" aria-label="新建文档">
              <RsIcon name="plus" size="sm" />
            </button>
          </RsTooltip>
          <RsTooltip content="搜索">
            <button type="button" class="icon-btn" aria-label="搜索">
              <RsIcon name="search" size="sm" />
            </button>
          </RsTooltip>
          <RsTooltip content="设置">
            <button type="button" class="icon-btn" aria-label="设置">
              <RsIcon name="settings" size="sm" />
            </button>
          </RsTooltip>
        </div>
      </DemoBlock>

      <DemoBlock title="场景：文本截断补全">
        <p class="hint">列表或表格中标题过长时，悬停展示完整文案。</p>
        <RsTooltip side="top" align="start" content="弱水 Studio — 设计系统与组件库维护文档（2026 Q2）">
          <p class="truncate-text">弱水 Studio — 设计系统与组件库维护文档（2026 Q2）</p>
        </RsTooltip>
      </DemoBlock>

      <DemoBlock title="场景：表单字段帮助">
        <p class="hint">
          <code>icon</code> 开启后缀帮助图标（Ant Design / Element 表单说明范式）：仅图标悬停出提示，不干扰点标签聚焦输入框。
        </p>
        <div class="field-row">
          <RsTooltip icon side="top" align="start" content="登录后默认打开的数据库，一般为 postgres 或业务库名。">
            <label class="field-label" for="db-name">初始数据库</label>
          </RsTooltip>
          <input id="db-name" class="field-input" type="text" placeholder="postgres" />
        </div>
        <div class="field-row">
          <RsTooltip icon side="top" align="start">
            <label class="field-label" for="api-key">API Key</label>
            <template #content>
              <p class="tooltip-line">在控制台「集成」页面生成。</p>
              <p class="tooltip-line">请勿将 Key 提交到公开仓库。</p>
            </template>
          </RsTooltip>
          <input id="api-key" class="field-input" type="text" placeholder="sk-..." />
        </div>
      </DemoBlock>
    </RsTooltipProvider>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0;
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
.placement-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 16rem;
  padding: 2rem;
  margin: 0 auto;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-bg);
}
.offset-label,
.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.offset-label code {
  color: var(--rs-text);
}
.tooltip-rich__title {
  margin: 0 0 0.25rem;
  font-weight: 600;
}
.tooltip-rich__desc {
  margin: 0;
  color: var(--rs-muted);
}
.toolbar {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-bg);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--rs-control-height-md);
  height: var(--rs-control-height-md);
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  cursor: pointer;
  outline: none;
}
.icon-btn:hover {
  background: var(--rs-item-hover);
}
.icon-btn:focus-visible {
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.truncate-text {
  max-width: 12rem;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
  cursor: default;
}
.field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.field-label {
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  outline: none;
}
.help-btn:hover {
  color: var(--rs-primary);
}
.help-btn:focus-visible {
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
  border-radius: var(--rs-radius-sm);
}
.field-input {
  flex: 1 1 12rem;
  min-width: 10rem;
  height: var(--rs-control-height-md);
  padding: 0 0.625rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  outline: none;
}
.field-input:focus-visible {
  border-color: var(--rs-primary);
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.tooltip-line {
  margin: 0;
  line-height: var(--rs-line-height-normal);
}
.tooltip-line + .tooltip-line {
  margin-top: 0.25rem;
}
</style>
