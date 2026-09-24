/** TCP 切帧。在连接打开时交给 api-service，UDP 不使用。 */

export type SocketFrameMode = 'raw' | 'delimiter' | 'length'
export type SocketFrameDelimiter = 'lf' | 'cr' | 'crlf'
export type SocketLengthSize = 1 | 2 | 4
export type SocketLengthEndian = 'big' | 'little'

export interface SocketFrameChoice {
  mode: SocketFrameMode
  delimiter: SocketFrameDelimiter
  lengthOffset: number
  /** 打开连接前会经 normalizeLengthSize 收成 1、2 或 4。 */
  lengthSize: number
  lengthEndian: SocketLengthEndian
  lengthAdjust: number
}

export interface SocketFrameOpen {
  frame: SocketFrameMode
  delimiter?: SocketFrameDelimiter
  lengthOffset?: number
  lengthSize?: number
  lengthEndian?: 'big' | 'little'
  lengthAdjust?: number
}

export interface SocketLengthFields {
  lengthOffset: number
  lengthSize: SocketLengthSize
  lengthEndian: SocketLengthEndian
  lengthAdjust: number
}

const MAX_LENGTH_OFFSET = 64
const MIN_LENGTH_ADJUST = -64
const MAX_LENGTH_ADJUST = 1 << 20

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampLengthOffset(value: number): number {
  return clampInt(value, 0, MAX_LENGTH_OFFSET, 4)
}

export function clampLengthAdjust(value: number): number {
  return clampInt(value, MIN_LENGTH_ADJUST, MAX_LENGTH_ADJUST, 0)
}

export function normalizeLengthSize(value: number): SocketLengthSize {
  if (value === 1 || value === 4) return value
  return 2
}

/** Modbus TCP：长度在偏移 4，2 字节大端，总长 = 6 + length。 */
export function modbusLengthFields(): SocketLengthFields {
  return { lengthOffset: 4, lengthSize: 2, lengthEndian: 'big', lengthAdjust: 0 }
}

/** 报文开头的 U16 BE，总长 = 2 + 字段值。 */
export function u16beLengthFields(): SocketLengthFields {
  return { lengthOffset: 0, lengthSize: 2, lengthEndian: 'big', lengthAdjust: 0 }
}

export function sameLengthFields(choice: SocketLengthFields, preset: SocketLengthFields): boolean {
  return (
    clampLengthOffset(choice.lengthOffset) === preset.lengthOffset &&
    normalizeLengthSize(choice.lengthSize) === preset.lengthSize &&
    choice.lengthEndian === preset.lengthEndian &&
    clampLengthAdjust(choice.lengthAdjust) === preset.lengthAdjust
  )
}

/** 长度头总长 = 偏移 + 字段宽度 + 字段值 + 调整量。 */
export function frameOpenFields(choice: SocketFrameChoice): SocketFrameOpen {
  if (choice.mode === 'delimiter') {
    return { frame: 'delimiter', delimiter: choice.delimiter }
  }
  if (choice.mode === 'length') {
    return {
      frame: 'length',
      lengthOffset: clampLengthOffset(choice.lengthOffset),
      lengthSize: normalizeLengthSize(choice.lengthSize),
      lengthEndian: choice.lengthEndian === 'little' ? 'little' : 'big',
      lengthAdjust: clampLengthAdjust(choice.lengthAdjust),
    }
  }
  return { frame: 'raw' }
}
