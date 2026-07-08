<script setup lang="ts">
import { ref } from 'vue'
import { RsContextMenu } from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const lastSelect = ref('（尚未选择）')

const basicItems = [
  { key: 'open', label: '打开', icon: 'folder-open' },
  { key: 'rename', label: '重命名', icon: 'pen-line' },
  { key: 'copy', label: '复制链接', icon: 'link' },
]

const separatorItems = [
  { key: 'edit', label: '编辑', icon: 'pen-line' },
  { key: 'duplicate', label: '创建副本', icon: 'copy' },
  { key: 'sep-1', label: '', separator: true },
  { key: 'archive', label: '归档', icon: 'archive' },
  { key: 'delete', label: '删除', icon: 'trash-2', danger: true },
]

const disabledItems = [
  { key: 'view', label: '查看详情', icon: 'eye' },
  { key: 'share', label: '分享（无权限）', icon: 'share-2', disabled: true },
  { key: 'export', label: '导出（维护中）', icon: 'download', disabled: true },
]

const submenuItems = [
  { key: 'cut', label: '剪切', icon: 'scissors' },
  { key: 'copy', label: '复制', icon: 'copy' },
  { key: 'paste', label: '粘贴', icon: 'clipboard' },
  {
    key: 'share-submenu',
    label: '分享到',
    icon: 'share-2',
    children: [
      { key: 'slack', label: 'Slack', icon: 'message-square' },
      { key: 'email', label: '邮件', icon: 'mail' },
      { key: 'link', label: '复制链接', icon: 'link' },
    ],
  },
  { key: 'sep-2', label: '', separator: true },
  { key: 'delete', label: '删除', icon: 'trash-2', danger: true },
]

const files = [
  { id: '1', name: '设计稿 v3.fig', type: '设计', updated: '今天 14:20' },
  { id: '2', name: 'API 规范.md', type: '文档', updated: '昨天 09:15' },
  { id: '3', name: 'release-notes.json', type: '配置', updated: '6 月 10 日' },
]

const fileMenuItems = [
  { key: 'open', label: '打开', icon: 'folder-open' },
  { key: 'preview', label: '预览', icon: 'eye' },
  { key: 'sep', label: '', separator: true },
  {
    key: 'move',
    label: '移动到',
    icon: 'folder',
    children: [
      { key: 'move-design', label: '设计资源' },
      { key: 'move-docs', label: '文档中心' },
      { key: 'move-archive', label: '归档', disabled: true },
    ],
  },
  { key: 'download', label: '下载', icon: 'download' },
  { key: 'sep-2', label: '', separator: true },
  { key: 'delete', label: '移入回收站', icon: 'trash-2', danger: true },
]

const activeFile = ref('')

function onSelect(key: string) {
  lastSelect.value = `${key} · ${new Date().toLocaleTimeString()}`
}

function onFileAction(key: string, fileName: string) {
  lastSelect.value = `${fileName} → ${key} · ${new Date().toLocaleTimeString()}`
}
</script>

<template>
  <DemoPage title="RsContextMenu" test-file="RsContextMenu.spec.ts">
    <DemoBlock title="基础右键菜单">
      <p class="hint">
        在触发区域<strong>右键</strong>打开菜单；选中项通过 <code>@select</code> 回传
        <code>key</code>。
      </p>
      <RsContextMenu :items="basicItems" @select="onSelect">
        <button type="button" class="trigger-panel">
          <span class="trigger-panel__title">项目文档</span>
          <span class="trigger-panel__hint">在此区域右键打开菜单</span>
        </button>
      </RsContextMenu>
      <p class="value">最近操作：<code>{{ lastSelect }}</code></p>
    </DemoBlock>

    <DemoBlock title="图标与分隔线">
      <p class="hint">
        <code>icon</code> 展示左侧图标；<code>separator: true</code> 渲染分隔线（危险项常用
        <code>danger: true</code>）。
      </p>
      <RsContextMenu :items="separatorItems" @select="onSelect">
        <button type="button" class="trigger-panel trigger-panel--compact">
          右键：编辑 / 归档 / 删除
        </button>
      </RsContextMenu>
    </DemoBlock>

    <DemoBlock title="禁用项 disabled">
      <p class="hint"><code>disabled: true</code> 的项不可选，呈现降低透明度样式。</p>
      <RsContextMenu :items="disabledItems" @select="onSelect">
        <button type="button" class="trigger-panel trigger-panel--compact">
          右键查看可用操作
        </button>
      </RsContextMenu>
    </DemoBlock>

    <DemoBlock title="子菜单 children">
      <p class="hint">含 <code>children</code> 的项渲染为二级子菜单，悬停或键盘导航展开。</p>
      <RsContextMenu :items="submenuItems" @select="onSelect">
        <button type="button" class="trigger-panel">
          <span class="trigger-panel__title">剪贴板操作</span>
          <span class="trigger-panel__hint">含「分享到」子菜单</span>
        </button>
      </RsContextMenu>
    </DemoBlock>

    <DemoBlock title="场景：文件列表">
      <p class="hint">每行作为触发区域，复用同一套菜单配置，通过闭包区分目标文件。</p>
      <ul class="file-list">
        <li v-for="file in files" :key="file.id" class="file-row">
          <RsContextMenu
            :items="fileMenuItems"
            @select="(key) => onFileAction(key, file.name)"
          >
            <button
              type="button"
              class="file-row__trigger"
              :class="{ 'file-row__trigger--active': activeFile === file.id }"
              @focus="activeFile = file.id"
            >
              <span class="file-row__name">{{ file.name }}</span>
              <span class="file-row__meta">{{ file.type }} · {{ file.updated }}</span>
            </button>
          </RsContextMenu>
        </li>
      </ul>
      <p class="value">最近操作：<code>{{ lastSelect }}</code></p>
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
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
}
.trigger-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  padding: 1rem 1.25rem;
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  text-align: left;
  cursor: context-menu;
  outline: none;
}
.trigger-panel:focus-visible {
  border-color: var(--rs-primary);
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.trigger-panel--compact {
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.trigger-panel__title {
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.trigger-panel__hint {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-md);
  overflow: hidden;
}
.file-row + .file-row {
  border-top: 1px solid var(--rs-border-subtle);
}
.file-row__trigger {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: context-menu;
  outline: none;
}
.file-row__trigger:hover,
.file-row__trigger--active {
  background: var(--rs-surface-hover);
}
.file-row__trigger:focus-visible {
  background: var(--rs-item-hover);
  box-shadow: inset 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.file-row__name {
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  color: var(--rs-text);
}
.file-row__meta {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
