<script setup lang="ts">
import { ref } from 'vue'
import {
  RsButton,
  RsCalendarGrid,
  RsCodeEditor,
  RsConfirmDialog,
  RsDatePicker,
  RsDateTimePicker,
  RsDrawer,
  RsForm,
  RsPagination,
  RsSidebar,
  RsSidebarGroup,
  RsSidebarItem,
  RsStatCard,
  RsSteps,
  RsTable,
  RsTimePicker,
  RsTimePickerColumns,
  RsTree,
  RsUpload,
  RsVirtualList,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const confirmOpen = ref(false)
const drawerOpen = ref(false)
const date = ref('')
const time = ref('09:30')
const dateTime = ref('')
const calendar = ref('')
const step = ref('design')
const page = ref(1)
const pageSize = ref(10)
const treeValue = ref('')
const files = ref<File[]>([])
const code = ref('{\n  "name": "ruoshui"\n}')

const steps = [
  { value: 'design', title: '设计', description: '确定交互与视觉' },
  { value: 'build', title: '开发', description: '组件实现' },
  { value: 'verify', title: '验收', description: '测试与 Playground' },
]

const columns = [
  { key: 'name', title: '名称', sortable: true },
  { key: 'status', title: '状态' },
  { key: 'count', title: '数量', align: 'right' as const, sortable: true },
]

const rows = [
  { id: '1', name: '任务编排', status: '运行中', count: 12 },
  { id: '2', name: '数据同步', status: '已停止', count: 7 },
  { id: '3', name: '质量检查', status: '待处理', count: 23 },
]

const treeNodes = [
  {
    key: 'workspace',
    label: '工作区',
    children: [
      { key: 'flows', label: '流程' },
      { key: 'datasets', label: '数据集' },
    ],
  },
]

const virtualItems = Array.from({ length: 100 }, (_, index) => `Item ${index + 1}`)
</script>

<template>
  <DemoPage title="Rs Studio Components" test-file="new Rs* specs">
    <DemoBlock title="反馈">
      <div class="row">
        <RsButton @click="confirmOpen = true">打开确认框</RsButton>
        <RsButton variant="default" @click="drawerOpen = true">打开抽屉</RsButton>
      </div>
      <RsConfirmDialog v-model:open="confirmOpen" title="删除任务？" description="删除后不可恢复。" />
      <RsDrawer v-model:open="drawerOpen" title="抽屉标题" description="支持左右上下侧滑。">
        抽屉内容区域
        <template #footer>
          <RsButton variant="default" @click="drawerOpen = false">关闭</RsButton>
        </template>
      </RsDrawer>
    </DemoBlock>

    <DemoBlock title="表单与日期时间">
      <RsForm class="grid">
        <RsDatePicker v-model="date" label="日期" />
        <RsTimePicker v-model="time" label="时间" />
        <RsDateTimePicker v-model="dateTime" label="日期时间" />
        <RsTimePickerColumns v-model="time" />
        <RsCalendarGrid v-model="calendar" />
      </RsForm>
    </DemoBlock>

    <DemoBlock title="导航与指标">
      <div class="layout-row">
        <RsSidebar v-model:collapsed="drawerOpen" title="弱水" collapsible>
          <RsSidebarGroup title="导航">
            <RsSidebarItem label="仪表盘" icon="layout-dashboard" active />
            <RsSidebarItem label="设置" icon="settings" />
          </RsSidebarGroup>
        </RsSidebar>
        <div class="stack">
          <RsStatCard label="运行中" :value="12" accent="success" />
          <RsSteps v-model="step" :items="steps" clickable />
        </div>
      </div>
    </DemoBlock>

    <DemoBlock title="数据组件">
      <RsTable :columns="columns" :data="rows" />
      <RsPagination v-model:page="page" v-model:page-size="pageSize" :total="128" show-page-size />
      <RsTree v-model="treeValue" :nodes="treeNodes" default-expand-all />
      <RsUpload v-model="files" multiple />
      <RsVirtualList :items="virtualItems" :height="160">
        <template #default="{ item }">
          <div class="virtual-item">{{ item }}</div>
        </template>
      </RsVirtualList>
    </DemoBlock>

    <DemoBlock title="代码编辑器">
      <RsCodeEditor v-model="code" language="json" :height="220" />
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.layout-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--rs-space-lg);
}
.stack {
  display: grid;
  align-content: start;
  gap: var(--rs-space-lg);
}
.virtual-item {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}
</style>
