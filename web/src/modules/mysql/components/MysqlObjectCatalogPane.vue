<script setup lang="ts">
/**
 * MySQL 库对象一览：挂载公共 ObjectCatalogShell。
 * 双击库 / 分类节点打开；同一连接复用一个 Tab。
 */
import { RsButton, RsTable } from '@niuma/ui'
import { ObjectCatalogShell } from '@/modules/database'
import { useMysqlObjectCatalog } from '@/modules/mysql/composables/useMysqlObjectCatalog'
import { isCategoryId, type CategoryId } from '@/modules/mysql/conn-tree-shared'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  catalogCategory?: CategoryId
  sessionLabel?: string
  active: boolean
}>()

const {
  t,
  category,
  filterText,
  createOpen,
  loading,
  scopeOk,
  loaded,
  protectedDb,
  categoryTabs,
  filteredRows,
  selectedRowKeys,
  columns,
  shellLabels,
  statusMeta,
  statusHint,
  canDdl,
  load,
  openQuery,
  openCreate,
  openDdl,
  onRowDblclick,
  contextMenuItems,
  onContextMenuSelect,
} = useMysqlObjectCatalog(props)

function onCategoryUpdate(id: string): void {
  if (isCategoryId(id)) category.value = id
}
</script>

<template>
  <ObjectCatalogShell
    v-model:filter-text="filterText"
    v-model:create-open="createOpen"
    brand-icon="mysql"
    :labels="shellLabels"
    :session-label="sessionLabel"
    :scope-label="database"
    :loading="loading"
    :has-scope="scopeOk"
    :has-result="loaded"
    :has-rows="filteredRows.length > 0"
    :can-ddl="canDdl"
    :show-create="!protectedDb"
    :categories="categoryTabs"
    :category="category"
    :status-meta="statusMeta"
    :status-hint="statusHint"
    @update:category="onCategoryUpdate"
    @query="openQuery"
    @refresh="load"
    @ddl="openDdl"
  >
    <template #create-menu>
      <div class="nm-mysql-catalog__create">
        <RsButton
          variant="ghost"
          size="sm"
          icon="layout-list"
          class="nm-mysql-catalog__create-item"
          @click="openCreate('tables')"
        >
          {{ t('modules.mysql.tree.create.tables') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="eye"
          class="nm-mysql-catalog__create-item"
          @click="openCreate('views')"
        >
          {{ t('modules.mysql.tree.create.views') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="workflow"
          class="nm-mysql-catalog__create-item"
          @click="openCreate('procedures')"
        >
          {{ t('modules.mysql.tree.create.procedures') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="square-function"
          class="nm-mysql-catalog__create-item"
          @click="openCreate('functions')"
        >
          {{ t('modules.mysql.tree.create.functions') }}
        </RsButton>
      </div>
    </template>

    <RsTable
      v-model:selected-row-keys="selectedRowKeys"
      :columns="columns"
      :data="filteredRows"
      size="sm"
      fill
      striped
      resizable
      cell-tooltip
      selectable
      row-key="__rowKey"
      :virtual-auto-threshold="40"
      :context-menu-items="contextMenuItems"
      @row-dblclick="onRowDblclick"
      @context-menu-select="onContextMenuSelect"
    />
  </ObjectCatalogShell>
</template>

<style scoped>
.nm-mysql-catalog__create {
  display: flex;
  flex-direction: column;
  min-width: 10rem;
  padding: 0.2rem;
  gap: 2px;
}

.nm-mysql-catalog__create-item {
  width: 100%;
  justify-content: flex-start;
}
</style>
