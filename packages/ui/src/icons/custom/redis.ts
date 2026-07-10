import { defineComponent, h, type PropType } from 'vue'

/**
 * Redis 官方品牌图形路径（Simple Icons 项目收录，CC0 1.0 授权，可自由商用且无需署名）。
 * 来源：https://github.com/simple-icons/simple-icons/blob/develop/icons/redis.svg
 */
const REDIS_MARK_PATH =
  'M22.71 13.145c-1.66 2.092-3.452 4.483-7.038 4.483-3.203 0-4.397-2.825-4.48-5.12.701 1.484 2.073 2.685 4.214 2.63 4.117-.133 6.94-3.852 6.94-7.239 0-4.05-3.022-6.972-8.268-6.972-3.752 0-8.4 1.428-11.455 3.685C2.59 6.937 3.885 9.958 4.35 9.626c2.648-1.904 4.748-3.13 6.784-3.744C8.12 9.244.886 17.05 0 18.425c.1 1.261 1.66 4.648 2.424 4.648.232 0 .431-.133.664-.365a100.49 100.49 0 0 0 5.54-6.765c.222 3.104 1.748 6.898 6.014 6.898 3.819 0 7.604-2.756 9.33-8.965.2-.764-.73-1.361-1.261-.73zm-4.349-5.013c0 1.959-1.926 2.922-3.685 2.922-.941 0-1.664-.247-2.235-.568 1.051-1.592 2.092-3.225 3.21-4.973 1.972.334 2.71 1.43 2.71 2.619z'

/**
 * NiuMa Redis —— 官方品牌 mark，单色填充，默认走 Redis 红并随主题明暗自动调整对比度
 * （比通用的 `server` 图标更能一眼识别协议类型）。
 */
export const RedisIcon = defineComponent({
  name: 'RedisIcon',
  inheritAttrs: false,
  props: {
    size: { type: [Number, String] as PropType<number | string>, default: 24 },
    strokeWidth: { type: [Number, String] as PropType<number | string>, default: 2 },
    color: { type: String, default: 'currentColor' },
  },
  setup(props, { attrs }) {
    return () => {
      const size = Number(props.size) || 24
      const { class: attrClass, style: attrStyle, ...restAttrs } = attrs
      const accent = props.color && props.color !== 'currentColor' ? props.color : undefined
      const style: Record<string, string> = {
        ...(typeof attrStyle === 'object' && attrStyle && !Array.isArray(attrStyle)
          ? (attrStyle as Record<string, string>)
          : {}),
        ...(accent ? { '--rs-icon-redis-accent': accent } : {}),
      }

      return h(
        'svg',
        {
          ...restAttrs,
          xmlns: 'http://www.w3.org/2000/svg',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          overflow: 'visible',
          style: Object.keys(style).length > 0 ? style : undefined,
          class: ['lucide', 'lucide-redis-icon', attrClass].filter(Boolean),
        },
        [h('path', { class: 'redis-icon__mark', d: REDIS_MARK_PATH })],
      )
    }
  },
})
