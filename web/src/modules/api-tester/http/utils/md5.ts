/**
 * MD5。摘要认证需要它，Web Crypto 不提供 MD5。
 */

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32))

/** 对 UTF-8 字节做 MD5，返回小写十六进制。 */
export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const bitLen = bytes.length * 8
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  withPad.set(bytes)
  withPad[bytes.length] = 0x80
  const view = new DataView(withPad.buffer)
  view.setUint32(withPad.length - 8, bitLen >>> 0, true)
  view.setUint32(withPad.length - 4, Math.floor(bitLen / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < withPad.length; offset += 64) {
    const m = new Uint32Array(16)
    for (let i = 0; i < 16; i += 1) m[i] = view.getUint32(offset + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i += 1) {
      let f = 0
      let g = 0
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const next = (b + rotl((a + f + K[i]! + m[g]!) >>> 0, SHIFT[i]!)) >>> 0
      a = d
      d = c
      c = b
      b = next
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  return [a0, b0, c0, d0].map(hex32).join('')
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function hex32(value: number): string {
  const bytes = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
