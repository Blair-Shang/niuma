import { describe, expect, it } from 'vitest'
import { frameOpenFields, modbusLengthFields, u16beLengthFields } from './frame'

const base = {
  delimiter: 'crlf' as const,
  ...modbusLengthFields(),
}

describe('frameOpenFields', () => {
  it('sends delimiter without length fields', () => {
    expect(frameOpenFields({ ...base, mode: 'delimiter', delimiter: 'lf' })).toEqual({
      frame: 'delimiter',
      delimiter: 'lf',
    })
  })

  it('sends the length fields the user set', () => {
    expect(
      frameOpenFields({
        ...base,
        mode: 'length',
        lengthOffset: 0,
        lengthSize: 4,
        lengthEndian: 'little',
        lengthAdjust: -2,
      }),
    ).toEqual({
      frame: 'length',
      lengthOffset: 0,
      lengthSize: 4,
      lengthEndian: 'little',
      lengthAdjust: -2,
    })
  })

  it('clamps length fields into the backend range', () => {
    expect(
      frameOpenFields({
        ...base,
        mode: 'length',
        lengthOffset: 99,
        lengthSize: 3,
        lengthEndian: 'big',
        lengthAdjust: -100,
      }),
    ).toEqual({
      frame: 'length',
      lengthOffset: 64,
      lengthSize: 2,
      lengthEndian: 'big',
      lengthAdjust: -64,
    })
  })

  it('maps the U16 BE preset', () => {
    const preset = u16beLengthFields()
    expect(frameOpenFields({ ...base, mode: 'length', ...preset })).toMatchObject({
      lengthOffset: 0,
      lengthSize: 2,
      lengthEndian: 'big',
      lengthAdjust: 0,
    })
  })
})
