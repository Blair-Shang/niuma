import * as echarts from 'echarts/core'

let worldMapLoading: Promise<void> | null = null

/** 懒加载并注册 ECharts 世界地图（仅首次调用时请求）。 */
export function ensureWorldMap(): Promise<void> {
  if (echarts.getMap('world')) {
    return Promise.resolve()
  }
  if (!worldMapLoading) {
    worldMapLoading = fetch(`${import.meta.env.BASE_URL}maps/world.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`world map load failed: ${response.status}`)
        }
        return response.json()
      })
      .then((geoJson) => {
        echarts.registerMap('world', geoJson)
      })
      .catch((error) => {
        worldMapLoading = null
        throw error
      })
  }
  return worldMapLoading
}

export function isWorldMapReady(): boolean {
  return !!echarts.getMap('world')
}
