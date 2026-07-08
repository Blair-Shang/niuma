<script setup lang="ts">
import { RsConfigProvider, RsToaster } from '@ruoshui/ui'
import PlaygroundLayout from './layouts/PlaygroundLayout.vue'
import {
  playgroundToasterCloseButton,
  playgroundToasterPosition,
  playgroundToasterRichColors,
} from './composables/playground-toaster'
</script>

<template>
  <RsConfigProvider>
    <RsToaster
      :position="playgroundToasterPosition"
      :close-button="playgroundToasterCloseButton"
      :rich-colors="playgroundToasterRichColors"
    />
    <PlaygroundLayout />
  </RsConfigProvider>
</template>
