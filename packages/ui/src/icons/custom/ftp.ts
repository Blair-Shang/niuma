import { defineComponent, h, type PropType } from 'vue'

/** Lucide folder 轮廓 */
const FOLDER_PATH =
  'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'

/**
 * NiuMa FTP — 橙色实心文件夹 + 居中白色「FTP」，避免轮廓与色块半覆盖。
 */
export const FtpIcon = defineComponent({
  name: 'FtpIcon',
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
      const accent =
        props.color && props.color !== 'currentColor' ? props.color : undefined
      const style: Record<string, string> = {
        ...(typeof attrStyle === 'object' && attrStyle && !Array.isArray(attrStyle)
          ? (attrStyle as Record<string, string>)
          : {}),
        ...(accent ? { '--rs-icon-ftp-accent': accent } : {}),
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
          class: ['lucide', 'lucide-ftp-icon', attrClass].filter(Boolean),
        },
        [
          h('path', { class: 'ftp-icon__folder', d: FOLDER_PATH }),
          h(
            'text',
            {
              class: 'ftp-icon__label',
              x: 12,
              y: 15,
              textAnchor: 'middle',
              dy: '0.35em',
            },
            'FTP',
          ),
        ],
      )
    }
  },
})
