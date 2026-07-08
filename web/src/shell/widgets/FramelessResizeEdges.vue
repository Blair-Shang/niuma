<script setup lang="ts">
import { windowApi } from '@/api/window'

const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

type ResizeEdge = (typeof edges)[number]

function onPointerDown(edge: ResizeEdge, event: PointerEvent): void {
  event.preventDefault()
  void windowApi.startResize({ edge }).catch(() => {})
}
</script>

<template>
  <div class="nm-frameless-resize" aria-hidden="true">
    <div
      v-for="edge in edges"
      :key="edge"
      class="nm-frameless-resize__edge nm-no-drag"
      :class="`nm-frameless-resize__edge--${edge}`"
      @pointerdown="onPointerDown(edge, $event)"
    />
  </div>
</template>
