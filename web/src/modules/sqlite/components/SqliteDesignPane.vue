<script setup lang="ts">
/**
 * SQLite 表设计器：挂载公共 TableDesignShell + PreviewPopover。
 * 布局与 MySQL Design 对齐（侧栏属性编辑 · 列上下移动）。
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
        :title="d.shellLabels.previewTitle"
        :sql="d.previewSqls"
        :loading="d.previewLoading"
        :copy-label="d.shellLabels.copyPreview"
        :empty-label="d.t('modules.sqlite.design.noChanges')"
        @update:open="d.onPreviewOpenChange"
        @copy="d.copyPreviewSql"
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
      <p v-if="d.designWarning" class="nm-sqlite-design__warning" role="status">
        <span v-if="d.designStrategy" class="nm-sqlite-design__strategy">{{
          d.t('modules.sqlite.design.strategy', { strategy: d.designStrategy })
        }}</span>
        {{ d.designWarning }}
      </p>
      <p v-else class="nm-sqlite-design__hint">{{ d.t('modules.sqlite.design.gridEditHint') }}</p>
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
          @context-menu-select="
            (key, row) => key === 'remove' && row && d.removeCol(String(row.__rowKey))
          "
        />
      </template>

      <template v-else-if="d.activeSection === 'indexes'">
        <RsEmpty
          v-if="d.displayIndexes.length === 0"
          :description="d.t('modules.sqlite.design.noIndexes')"
        />
        <RsTable
          v-else
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
        <RsEmpty
          v-if="d.displayForeignKeys.length === 0"
          :description="d.t('modules.sqlite.design.noForeignKeys')"
        />
        <RsTable
          v-else
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
              :options="d.typeBaseSelectOptions"
              @update:model-value="
                d.updateColSideField(d.editingCol!.__rowKey, 'typeBase', String($event))
              "
            />
          </div>
          <div
            v-if="d.dataTypeParamKind(d.editingCol.typeBase) === 'length'"
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
          <div class="nm-sqlite-design__field nm-sqlite-design__field--check">
            <label>{{ d.t('modules.sqlite.design.colPk') }}</label>
            <input
              type="checkbox"
              :checked="d.editingCol.primaryKey"
              @change="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'primaryKey',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
          </div>
          <div class="nm-sqlite-design__field nm-sqlite-design__field--check">
            <label>{{ d.t('modules.sqlite.design.colNullable') }}</label>
            <input
              type="checkbox"
              :checked="d.editingCol.nullable"
              :disabled="d.editingCol.primaryKey"
              @change="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'nullable',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
          </div>
          <div class="nm-sqlite-design__field nm-sqlite-design__field--check">
            <label>{{ d.t('modules.sqlite.design.colAi') }}</label>
            <input
              type="checkbox"
              :checked="d.editingCol.autoIncrement"
              :disabled="Boolean(d.editingCol.generatedType)"
              @change="
                d.updateColSideField(
                  d.editingCol!.__rowKey,
                  'autoIncrement',
                  ($event.target as HTMLInputElement).checked,
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
              @update:model-value="
                d.updateIdxSideField(d.editingIdx!.__rowKey, 'name', String($event ?? ''))
              "
            />
          </div>
          <div class="nm-sqlite-design__field">
            <label>{{ d.t('modules.sqlite.design.idxColumns') }}</label>
            <RsSelect
              :model-value="
                d.editingIdx.columnsText
                  ? d.editingIdx.columnsText.split(',').map((s) => s.trim()).filter(Boolean)
                  : []
              "
              size="sm"
              multiple
              :options="d.draftColumnSelectOptions"
              :disabled="d.editingIdx.primary"
              @update:model-value="
                d.updateIdxSideField(
                  d.editingIdx!.__rowKey,
                  'columnsText',
                  d.columnsTextFromSelect($event),
                )
              "
            />
          </div>
          <div class="nm-sqlite-design__field nm-sqlite-design__field--check">
            <label>{{ d.t('modules.sqlite.design.idxUnique') }}</label>
            <input
              type="checkbox"
              :checked="d.editingIdx.unique"
              :disabled="d.editingIdx.primary"
              @change="
                d.updateIdxSideField(
                  d.editingIdx!.__rowKey,
                  'unique',
                  ($event.target as HTMLInputElement).checked,
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
            <label>{{ d.t('modules.sqlite.design.fkName') }}</label>
            <RsInput
              :model-value="d.editingFk.name"
              size="sm"
              @update:model-value="
                d.updateFkSideField(d.editingFk!.__rowKey, 'name', String($event ?? ''))
              "
            />
          </div>
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
  gap: 8px;
  margin-bottom: 6px;
}
.nm-sqlite-design__meta-label {
  flex: 0 0 64px;
  font-size: 12px;
  color: var(--rs-fg-muted);
}
.nm-sqlite-design__meta-readonly {
  font-size: 13px;
  font-weight: 500;
}
.nm-sqlite-design__hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--rs-fg-muted);
}
.nm-sqlite-design__warning {
  margin: 0 0 4px;
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
  height: 100%;
  min-height: 0;
}
.nm-sqlite-design__editor-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
}
.nm-sqlite-design__form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-sqlite-design__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.nm-sqlite-design__field--check {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.nm-sqlite-design__editor-empty {
  display: flex;
  flex: 1;
  min-height: 8rem;
  align-items: center;
  justify-content: center;
}
</style>
