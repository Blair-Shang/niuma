<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { SshRemoteEncoding } from '@/api/types/ssh'
import SshTerminalPane from '@/modules/ssh/components/SshTerminalPane.vue'

const emit = defineEmits<{
  /** 当开启 syncInput 时，由任意分屏捕获到用户输入并上报父组件 */
  (e: 'broadcastInput', data: string): void
  (e: 'reconnect'): void
}>()

const props = defineProps<{
  sessionId: string | null
  termType?: string
  encoding?: SshRemoteEncoding
  /** 最多开启几个分屏 PTY */
  maxPanes?: number
  /** 外部控制分屏数量 */
  paneCount?: number
  /** 外部控制同步输入 */
  syncInput?: boolean
  /**
   * 多服务器/多 session 支持：当提供时，pane i 的 terminal 使用 sessionIds[i]。
   * 不提供则所有 pane 都使用 sessionId。
   */
  sessionIds?: Array<string | null>
}>()

const maxPanes = computed(() => props.maxPanes ?? 4)
const effectivePaneCount = computed(() => clamp(props.paneCount ?? 2, 1, maxPanes.value))
const syncInput = computed(() => props.syncInput ?? false)

type TerminalPaneExpose = {
  refreshSize: () => Promise<void>
  sendInput: (data: string) => Promise<void>
}

const paneRefs = ref<Array<TerminalPaneExpose | null>>([])

function setPaneRef(index: number) {
  return (el: Element | ComponentPublicInstance | null): void => {
    paneRefs.value[index] = el as TerminalPaneExpose | null
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function onBroadcastInput(data: string): void {
  if (!syncInput.value || !data) return
  // 任意一个分屏输入，都广播到组内所有终端 PTY
  for (const pane of paneRefs.value) {
    pane?.sendInput(data)
  }
  emit('broadcastInput', data)
}

function sessionIdAt(index: number): string | null {
  const sid = props.sessionIds?.[index]
  if (sid !== undefined) return sid
  return props.sessionId
}

watch(
  effectivePaneCount,
  (next) => {
    // 规避 refs 缩减后仍残留旧实例，导致向“已销毁但仍在数组里的 refs”广播输入
    paneRefs.value = paneRefs.value.slice(0, next)
  },
  { immediate: true },
)

async function refreshSize(): Promise<void> {
  for (const pane of paneRefs.value) {
    await pane?.refreshSize()
  }
}

defineExpose({
  refreshSize,
  /** 外部注入输入（跨 Tab/跨组同步用） */
  async sendInput(data: string): Promise<void> {
    if (!data) return
    for (const pane of paneRefs.value) {
      await pane?.sendInput(data)
    }
  },
})
</script>

<template>
  <section class="nm-ssh-term-group">
    <div
      class="nm-ssh-term-group__grid"
      :style="{
        gridTemplateColumns:
          effectivePaneCount === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
      }"
    >
      <SshTerminalPane
        v-for="i in effectivePaneCount"
        :key="i"
        :ref="setPaneRef(i - 1)"
        :session-id="sessionIdAt(i - 1)"
        :term-type="termType"
        :encoding="encoding"
        :sync-broadcast="syncInput"
        @broadcastInput="onBroadcastInput"
        @reconnect="emit('reconnect')"
      />
    </div>
  </section>
</template>

<style scoped>
.nm-ssh-term-group {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-ssh-term-group__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  overflow: hidden;
}
</style>

