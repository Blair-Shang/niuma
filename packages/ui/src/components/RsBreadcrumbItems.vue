<script setup lang="ts">
import type { RsBreadcrumbRenderItem } from './breadcrumb-utils'
import RsIcon from './RsIcon.vue'

defineProps<{
  items: RsBreadcrumbRenderItem[]
  separatorLabel: string
}>()
</script>

<template>
  <ol class="rs-breadcrumb__list">
    <li
      v-for="(item, index) in items"
      :key="item.key"
      class="rs-breadcrumb__item"
    >
      <component
        :is="item.isLink ? 'a' : 'span'"
        :href="item.href"
        class="rs-breadcrumb__link"
        :class="{ 'rs-breadcrumb__link--current': item.isCurrent }"
        :aria-current="item.isCurrent ? 'page' : undefined"
      >
        {{ item.label }}
      </component>
      <RsIcon
        v-if="index < items.length - 1"
        name="chevron-right"
        :size="14"
        class="rs-breadcrumb__sep"
        :label="separatorLabel"
      />
    </li>
  </ol>
</template>
