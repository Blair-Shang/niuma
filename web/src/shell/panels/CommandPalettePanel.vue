<script setup lang="ts">
import { RsIcon, RsInput } from '@niuma/ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  executeCommand,
  filterCommands,
  type RegisteredCommand,
} from '@/extensions/contributions/command-registry'
import { useCommandPaletteStore } from '@/stores/command-palette'

const paletteStore = useCommandPaletteStore()
const { t } = useI18n()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<InstanceType<typeof RsInput> | null>(null)

const filtered = computed(() => filterCommands(query.value))

watch(filtered, () => {
  activeIndex.value = 0
})

/** 选中并执行命令，随后关闭面板 */
async function runCommand(cmd: RegisteredCommand): Promise<void> {
  paletteStore.hide()
  const ok = await executeCommand(cmd.id)
  if (!ok) {
    console.warn(`[CommandPalette] no handler for ${cmd.id}`)
  }
}

/** 方向键导航 + 回车执行 */
function onKeydown(event: KeyboardEvent): void {
  const list = filtered.value
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (list.length) {
      activeIndex.value = (activeIndex.value + 1) % list.length
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (list.length) {
      activeIndex.value = (activeIndex.value - 1 + list.length) % list.length
    }
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const cmd = list[activeIndex.value]
    if (cmd) {
      void runCommand(cmd)
    }
  }
}

onMounted(async () => {
  await nextTick()
  const el = inputRef.value?.$el?.querySelector('input') as HTMLInputElement | null
  el?.focus()
})
</script>

<template>
  <div class="nm-cmdk" @keydown="onKeydown">
    <RsInput
      ref="inputRef"
      v-model="query"
      class="nm-cmdk__input"
      :placeholder="t('commandPalette.placeholder')"
    >
      <template #prefix>
        <RsIcon name="search" :size="14" style="color: var(--rs-muted)" />
      </template>
    </RsInput>

    <ul v-if="filtered.length" class="nm-cmdk__list" role="listbox">
      <li
        v-for="(cmd, index) in filtered"
        :key="cmd.id"
        role="option"
        :aria-selected="index === activeIndex"
        class="nm-cmdk__item"
        :class="{ 'nm-cmdk__item--active': index === activeIndex }"
        @click="() => void runCommand(cmd)"
        @mouseenter="activeIndex = index"
      >
        <RsIcon v-if="cmd.icon" :name="cmd.icon" :size="14" class="nm-cmdk__item-icon" />
        <span class="nm-cmdk__item-title">{{ cmd.title }}</span>
        <span class="nm-cmdk__item-id">{{ cmd.id }}</span>
      </li>
    </ul>
    <p v-else class="nm-cmdk__empty nm-caption">{{ t('commandPalette.empty') }}</p>
  </div>
</template>

<style scoped>
.nm-cmdk {
  display: flex;
  flex-direction: column;
  width: min(34rem, 92vw);
}

.nm-cmdk__list {
  /* 抵消 popover 内边距，让结果列表铺满面板宽度 */
  margin: 0.5rem -0.75rem -0.75rem;
  padding: 0.375rem;
  max-height: min(22rem, 50vh);
  overflow-y: auto;
  list-style: none;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-cmdk__item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.6rem;
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  color: var(--rs-text);
  cursor: pointer;
}

.nm-cmdk__item--active {
  background: var(--rs-item-hover);
}

.nm-cmdk__item-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-cmdk__item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-cmdk__item-id {
  margin-left: auto;
  flex-shrink: 0;
  font-family: ui-monospace, monospace;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-cmdk__empty {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.25rem;
}
</style>
