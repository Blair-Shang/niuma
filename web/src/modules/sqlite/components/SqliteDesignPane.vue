<script setup lang="ts">
/**
 * SQLite 表设计器：挂载公共 TableDesignShell + PreviewPopover。
 * 布局与 MySQL Design 对齐（侧栏属性编辑 · 列拖拽/上下移动 · 索引/外键网格）。
 */
import { RsButton, RsEmpty, RsInput, RsSelect, RsTable } from '@niuma/ui'
import {
  TableDesignPreviewPopover,
  TableDesignShell,
} from '@/modules/database'
import { useSqliteDesignPane } from '@/modules/sqlite/composables/useSqliteDesignPane'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema: string
  table?: string
  designMode: 'create' | 'alter'
  active: boolean
  sessionLabel?: string
}>()

const d = useSqliteDesignPane(props)
</script>

<template>
  <TableDesignShell
    class="nm-sqlite-design"
    :labels="d.shellLabels"
    :title="d.title"
    :mode="d.designMode"
    :scope-label="sessionLabel"
    :loading="d.loading"
    :saving="d.saving"
    :show-reload="!d.modeCreate"
    :sections="d.sections"
    :active-section="d.activeSection"
    @reload="d.load"
    @apply="d.onApply"
    @update:active-section="d.activeSection = $event"
  >
    <template #preview>
      <TableDesignPreviewPopover
        :open="d.showPreview"
        :sql="d.previewSqls"
        :loading="d.previewLoading"
        :empty-label="d.t('modules.sqlite.design.noChanges')"
        @update:open="d.onPreviewOpenChange"
      >
        <RsButton size="sm" variant="ghost" :disabled="d.loading">
          {{ d.shellLabels.preview }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>

    <template #toolbar-extra>
      <RsButton size="sm" variant="ghost" icon="plus" @click="d.onAddCurrent">
        {{ d.addButtonLabel }}
      </RsButton>
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-up"
        :disabled="d.activeSection !== 'columns' || !d.editingColKey"
        :title="d.shellLabels.moveUp"
        @click="d.moveSelectedColumn(-1)"
      />
      <RsButton
        size="sm"
        variant="ghost"
        icon="arrow-down"
        :disabled="d.activeSection !== 'columns' || !d.editingColKey"
        :title="d.shellLabels.moveDown"
        @click="d.moveSelectedColumn(1)"
      />
    </template>

    <template #meta>
      <div class="nm-sqlite-design__meta-row">
        <label class="nm-sqlite-design__meta-label">{{
          d.t('modules.sqlite.design.tableName')
        }}</label>
        <RsInput
          v-if="d.modeCreate"
          v-model="d.tableName"
          size="sm"
          :placeholder="d.t('modules.sqlite.design.tableNamePh')"
        />
        <span v-else class="nm-sqlite-design__meta-readonly">{{
          d.effectiveTable || d.tableName
        }}</span>
      </div>
      <div v-if="d.modeCreate" class="nm-sqlite-design__meta-row nm-sqlite-design__meta-row--check">
        <label class="nm-sqlite-design__meta-label">{{
          d.t('modules.sqlite.design.tableStrict')
        }}</label>
        <input v-model="d.createStrict" type="checkbox" />
      </div>
      <div v-if="d.modeCreate" class="nm-sqlite-design__meta-row nm-sqlite-design__meta-row--check">
        <label class="nm-sqlite-design__meta-label">{{
          d.t('modules.sqlite.design.tableWithoutRowid')
        }}</label>
        <input v-model="d.createWithoutRowid" type="checkbox" />
      </div>
      <p v-if="d.designWarning" class="nm-sqlite-design__warning" role="status">
        <span v-if="d.designStrategy" class="nm-sqlite-design__strategy">{{
          d.t('modules.sqlite.design.strategy', { strategy: d.designStrategy })
        }}</span>
        {{ d.designWarning }}
      </p>
    </template>

    <template #list>
      <template v-if="d.activeSection === 'columns'">
        <RsTable
          class="nm-sqlite-design__grid"
          :columns="d.columnColumns"
          :data="d.displayColumns"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          show-index
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          row-draggable
          row-drop-mode="reorder"
          row-drag-trigger="handle"
          :highlighted-row-key="d.editingColKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: d.t('modules.sqlite.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              d.editingColKey = String(row.__rowKey)
              d.editingIdxKey = null
              d.editingFkKey = null
            }
          "
          @cell-edit-commit="d.onColCommit"
          @row-drop="d.onColumnRowDrop"
          @context-menu-select="
            (key, row) => key === 'remove' && row && d.removeCol(String(row.__rowKey))
          "
        />
      </template>

      <template v-else-if="d.activeSection === 'indexes'">
        <RsTable
          class="nm-sqlite-design__grid"
          :columns="d.indexColumns"
          :data="d.displayIndexes"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          :highlighted-row-key="d.editingIdxKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: d.t('modules.sqlite.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              d.editingIdxKey = String(row.__rowKey)
              d.editingColKey = null
              d.editingFkKey = null
            }
          "
          @cell-edit-commit="d.onIdxCommit"
          @context-menu-select="
            (key, row) => key === 'remove' && row && d.removeIdx(String(row.__rowKey))
          "
        />
      </template>

      <template v-else>
        <RsTable
          class="nm-sqlite-design__grid"
          :columns="d.fkColumns"
          :data="d.displayForeignKeys"
          row-key="__rowKey"
          size="sm"
          striped
          fill
          bordered
          column-bordered
          editable
          :edit-gutter="false"
          edit-trigger="dblclick"
          :highlighted-row-key="d.editingFkKey ?? undefined"
          :context-menu-items="
            (row) =>
              row
                ? [
                    {
                      key: 'remove',
                      label: d.t('modules.sqlite.design.remove'),
                      icon: 'trash-2',
                      danger: true,
                    },
                  ]
                : []
          "
          @row-click="
            (row) => {
              d.editingFkKey = String(row.__rowKey)
              d.editingColKey = null
              d.editingIdxKey = null
            }
          "
          @cell-edit-start="d.onFkEditStart"
          @cell-edit-commit="d.onFkCommit"
          @context-menu-select="
            (key, row) => key === 'remove' && row && d.removeFk(String(row.__rowKey))
          "
        />
      </template>
    </template>

    <template #editor>
      <template v-if="d.activeSection === 'columns' && d.editingCol">
        <div class="nm-sqlite-design__editor-title">{{
          d.t('modules.sqlite.design.editColumn')
        }}</div>
        <div class="nm-sqlite-design__form">
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colName') }}</label>
            <RsInput
              :model-value="d.editingCol.name"
              size="sm"
              @update:model-value="
                d.updateColSideField(d.editingCol!.__rowKey, 'name', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colType') }}</label>
            <RsSelect
              :model-value="d.editingCol.typeBase"
              size="sm"
              searchable
              creatable
              :options="d.typeBaseSelectOptions"
              @update:model-value="
                d.updateColSideField(d.editingCol!.__rowKey, 'typeBase', String($event))
              "
            />
          </div>
          <div
            v-if="
              d.dataTypeParamKind(d.editingCol.typeBase) === 'length' ||
              d.dataTypeParamKind(d.editingCol.typeBase) === 'precision'
            "
            class="nm-sqlite-design__field"
          >
            <label>{{ d.t('modules.sqlite.design.colLength') }}</label>
            <RsInput
              :model-value="
                d.editingCol.typeLength != null ? String(d.editingCol.typeLength) : ''
              "
              size="sm"
              @update:model-value="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'typeLength',
                  $event === '' || $event == null ? undefined : Number($event),
                )
              "
            />
          </div>
          <div
            v-if="d.dataTypeParamKind(d.editingCol.typeBase) === 'precision'"
            class="nm-sqlite-design__field"
          >
            <label>{{ d.t('modules.sqlite.design.colScale') }}</label>
            <RsInput
              :model-value="
                d.editingCol.typeScale != null ? String(d.editingCol.typeScale) : ''
              "
              size="sm"
              @update:model-value="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'typeScale',
                  $event === '' || $event == null ? undefined : Number($event),
                )
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colDefault') }}</label>
            <RsInput
              :model-value="d.editingCol.defaultExpr"
              size="sm"
              :disabled="Boolean(d.editingCol.generatedType)"
              :placeholder="d.t('modules.sqlite.design.colDefaultPh')"
              @update:model-value="
                d.updateColSideField(d.editingCol!.__rowKey, 'defaultExpr', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colCheck') }}</label>
            <RsInput
              :model-value="d.editingCol.checkExpr"
              size="sm"
              :placeholder="d.t('modules.sqlite.design.colCheckPh')"
              @update:model-value="
                d.updateColSideField(d.editingCol!.__rowKey, 'checkExpr', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colGenerated') }}</label>
            <RsSelect
              :model-value="d.editingCol.generatedType"
              size="sm"
              :options="d.generatedTypeOptions"
              @update:model-value="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'generatedType',
                  String($event ?? '') as '' | 'VIRTUAL' | 'STORED',
                )
              "
            />
          </div>
          <div v-if="d.editingCol.generatedType" class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.colGeneratedExpr') }}</label>
            <RsInput
              :model-value="d.editingCol.generatedExpr"
              size="sm"
              :placeholder="d.t('modules.sqlite.design.colGeneratedExprPh')"
              @update:model-value="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'generatedExpr',
                  String($event ?? ''),
                )
              "
            />
          </div>
          <p class="nm-sqlite-design__hint">{{ d.t('modules.sqlite.design.gridEditHint') }}</p>
        </div>
      </template>
      <template v-else-if="d.activeSection === 'indexes' && d.editingIdx">
        <div class="nm-sqlite-design__editor-title">{{
          d.t('modules.sqlite.design.editIndex')
        }}</div>
        <div class="nm-sqlite-design__form">
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.idxName') }}</label>
            <RsInput
              :model-value="d.editingIdx.name"
              size="sm"
              :disabled="d.editingIdx.primary"
              :placeholder="d.t('modules.sqlite.design.idxNamePh')"
              @update:model-value="
                d.updateIdxSideField(d.editingIdx!.__rowKey, 'name', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.idxKind') }}</label>
            <RsInput
              :model-value="
                d.editingIdx.primary
                  ? d.t('modules.sqlite.design.idxKindPrimary')
                  : d.editingIdx.unique
                    ? d.t('modules.sqlite.design.idxKindUnique')
                    : d.t('modules.sqlite.design.idxKindNormal')
              "
              size="sm"
              disabled
            />
          </div>
          <div v-if="!d.editingIdx.primary" class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.idxPartialWhere') }}</label>
            <RsInput
              :model-value="d.editingIdx.partialWhere"
              size="sm"
              :placeholder="d.t('modules.sqlite.design.idxPartialWherePh')"
              @update:model-value="
                d.updateIdxSideField(
                  d.editingIdx!.__rowKey,
                  'partialWhere',
                  String($event ?? ''),
                )
              "
            />
          </div>
        </div>
      </template>
      <template v-else-if="d.activeSection === 'foreignKeys' && d.editingFk">
        <div class="nm-sqlite-design__editor-title">{{
          d.t('modules.sqlite.design.editForeignKey')
        }}</div>
        <div class="nm-sqlite-design__form">
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.fkOnDelete') }}</label>
            <RsSelect
              :model-value="d.editingFk.onDelete"
              size="sm"
              :options="d.fkActionOptions"
              @update:model-value="
                d.updateFkSideField(d.editingFk!.__rowKey, 'onDelete', String($event))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.fkOnUpdate') }}</label>
            <RsSelect
              :model-value="d.editingFk.onUpdate"
              size="sm"
              :options="d.fkActionOptions"
              @update:model-value="
                d.updateFkSideField(d.editingFk!.__rowKey, 'onUpdate', String($event))
              "
            />
          </div>
        </div>
      </template>
      <div v-else class="nm-sqlite-design__editor-empty">
        <RsEmpty
          fill
          radius="none"
          icon-radius="none"
          :description="d.t('modules.sqlite.design.selectRow')"
        />
      </div>
    </template>
  </TableDesignShell>
</template>

<style scoped>
.nm-sqlite-design__meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nm-sqlite-design__meta-row--check {
  min-width: 120px;
}
.nm-sqlite-design__meta-label {
  font-size: 12px;
  color: var(--rs-fg-muted);
  white-space: nowrap;
  min-width: 60px;
}
.nm-sqlite-design__meta-readonly {
  font-size: 12px;
  font-weight: 500;
  min-width: 80px;
}
.nm-sqlite-design__warning {
  flex: 1 1 100%;
  margin: 0;
  font-size: 12px;
  color: var(--rs-warning, #b45309);
  line-height: 1.4;
}
.nm-sqlite-design__strategy {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--rs-warning, #b45309) 15%, transparent);
  font-weight: 600;
  font-size: 11px;
}
.nm-sqlite-design__grid {
  flex: 1;
  min-height: 0;
}
.nm-sqlite-design__editor-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.nm-sqlite-design__editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-sqlite-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-sqlite-design__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nm-sqlite-design__field label {
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-sqlite-design__hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--rs-fg-muted);
  line-height: 1.4;
}
</style>
