import { onBeforeUnmount, onMounted, type Ref } from 'vue'

export function useClickOutside(
  target: Ref<HTMLElement | null>,
  handler: () => void,
) {
  function onPointerDown(event: MouseEvent) {
    const el = target.value
    if (!el || el.contains(event.target as Node)) {
      return
    }
    handler()
  }

  onMounted(() => {
    document.addEventListener('mousedown', onPointerDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onPointerDown)
  })
}
