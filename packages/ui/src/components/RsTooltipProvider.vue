<script setup lang="ts">
import { TooltipProvider } from './reka'

withDefaults(
  defineProps<{
    delayDuration?: number
    skipDelayDuration?: number
  }>(),
  {
    delayDuration: 300,
    skipDelayDuration: 0,
  },
)
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration" :skip-delay-duration="skipDelayDuration">
    <slot />
  </TooltipProvider>
</template>
