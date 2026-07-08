/** 淡出并移除 index.html 内联启动层（Vue 首帧就绪后调用） */
export function dismissBootLoader(): void {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById('niuma-boot-loader')
  if (!el) {
    return
  }
  el.classList.add('niuma-boot-loader--hide')
  const remove = () => {
    el.remove()
  }
  el.addEventListener('transitionend', remove, { once: true })
  globalThis.setTimeout(remove, 300)
}
