/**
 * 等待浏览器完成至少 N 帧绘制后 resolve。
 *
 * CEF reveal 前调用，避免窗口 Show 时首帧未绘制导致黑屏闪烁。
 */
export function waitForPaint(frames = 4): Promise<void> {
  return new Promise((resolve) => {
    let remaining = frames
    function tick() {
      if (--remaining <= 0) {
        resolve()
      } else {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  })
}
