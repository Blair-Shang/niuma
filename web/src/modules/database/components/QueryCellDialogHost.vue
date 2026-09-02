<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import BrowseCellEditorDialog from './BrowseCellEditorDialog.vue'
import {
  claimQueryCellDialogSeat,
  isQueryCellDialogLeader,
  releaseQueryCellDialogSeat,
  useQueryCellDialogHost,
} from '../composables/query-cell-dialog-host'

const seat = claimQueryCellDialogSeat()
const isLeader = computed(() => isQueryCellDialogLeader(seat))
onBeforeUnmount(() => {
  releaseQueryCellDialogSeat(seat)
})

const { open, draft, title, labels, copyFull } = useQueryCellDialogHost()
</script>

<template>
  <Teleport v-if="isLeader" to="body">
    <BrowseCellEditorDialog
      v-model:open="open"
      v-model:draft="draft"
      :title="title"
      readonly
      :cancel-label="labels().close"
      :show-copy-full="true"
      :copy-full-label="labels().copyFull"
      :copied-label="labels().copied"
      @copy-full="copyFull"
    />
  </Teleport>
</template>
