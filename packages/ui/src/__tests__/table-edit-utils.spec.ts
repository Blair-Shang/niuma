import { describe, expect, it } from 'vitest'
import {
  RS_TABLE_NULL_DRAFT,
  booleanToEditText,
  coerceBoolean,
  isBooleanToggleColumn,
  isNullDraft,
  navigateEditableCell,
  parseCellEditInput,
  parseClipboardGrid,
  resolveColumnCommitOn,
  resolveColumnEditTrigger,
  stripNumberDecorations,
  resolveCellEditText,
  usesOverlayEditor,
  validateCellValue,
} from '../components/table/table-edit-utils'

describe('table-edit-utils editors', () => {
  it('normalizes ISO datetime for date picker binding', () => {
    expect(
      resolveCellEditText(
        { updatedAt: '2026-06-15T10:30:00' },
        { key: 'updatedAt', title: '更新时间', valueType: 'datetime' },
        0,
      ),
    ).toBe('2026-06-15 10:30:00')
    expect(
      resolveCellEditText(
        { birthday: '2024-01-15' },
        { key: 'birthday', title: '生日', valueType: 'date' },
        0,
      ),
    ).toBe('2024-01-15')
  })

  it('detects boolean toggle columns', () => {
    expect(isBooleanToggleColumn({ key: 'a', title: 'A', valueType: 'boolean' })).toBe(true)
    expect(isBooleanToggleColumn({ key: 'a', title: 'A', valueType: 'text' })).toBe(false)
  })

  it('uses change commit and click trigger for overlay editors', () => {
    expect(usesOverlayEditor('select')).toBe(true)
    expect(usesOverlayEditor('date')).toBe(true)
    expect(resolveColumnCommitOn({ key: 'k', title: 'K', valueType: 'select' }, false)).toBe(
      'change',
    )
    expect(resolveColumnCommitOn({ key: 'k', title: 'K', valueType: 'date' }, false)).toBe('enter')
    expect(resolveColumnCommitOn({ key: 'k', title: 'K', valueType: 'datetime' }, false)).toBe(
      'enter',
    )
    expect(resolveColumnEditTrigger({ key: 'k', title: 'K', valueType: 'select' }, 'dblclick')).toBe(
      'click',
    )
  })

  it('parses boolean edit text', () => {
    expect(coerceBoolean(true)).toBe(true)
    expect(coerceBoolean('YES')).toBe(true)
    expect(booleanToEditText(false)).toBe('false')
    expect(
      parseCellEditInput('true', { a: false }, { key: 'a', title: 'A', valueType: 'boolean' }, 0),
    ).toBe(true)
  })

  it('parses explicit NULL draft and emptyAsNull', () => {
    expect(isNullDraft(RS_TABLE_NULL_DRAFT)).toBe(true)
    expect(
      parseCellEditInput(RS_TABLE_NULL_DRAFT, { a: 'x' }, { key: 'a', title: 'A' }, 0),
    ).toBeNull()
    expect(
      parseCellEditInput('', { a: 'x' }, { key: 'a', title: 'A', emptyAsNull: true, nullable: true }, 0),
    ).toBeNull()
  })

  it('supports async validators', async () => {
    const { validateCellValueAsync, listBatchColumnTargets } = await import(
      '../components/table/table-edit-utils'
    )
    await expect(
      validateCellValueAsync(
        -1,
        { n: 0 },
        {
          key: 'n',
          title: 'N',
          validator: async (value) => (Number(value) >= 0 ? null : '异步不能为负'),
        },
        0,
      ),
    ).resolves.toBe('异步不能为负')

    const targets = listBatchColumnTargets({
      rows: [
        { row: { id: '1' }, rowIndex: 0, rowKey: '1' },
        { row: { id: '2' }, rowIndex: 1, rowKey: '2' },
        { row: { id: '3' }, rowIndex: 2, rowKey: '3' },
      ],
      column: { key: 'name', title: '名称', editable: true },
      tableEditable: true,
      selectedKeys: ['1', '3'],
      anchorRowKey: '1',
    })
    expect(targets.map((item) => item.rowKey)).toEqual(['1', '3'])
  })

  it('strips number decorations and validates', () => {
    expect(stripNumberDecorations('1,234.5')).toBe('1234.5')
    expect(
      parseCellEditInput('1,200', { n: 0 }, { key: 'n', title: 'N', valueType: 'number' }, 0),
    ).toBe(1200)
    expect(
      validateCellValue(-1, { n: 0 }, {
        key: 'n',
        title: 'N',
        validator: (value) => (Number(value) >= 0 ? null : '不能为负'),
      }, 0),
    ).toBe('不能为负')
  })

  it('parses clipboard TSV grid', () => {
    expect(parseClipboardGrid('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('navigates editable cells', () => {
    const cells = [
      { rowKey: '1', colKey: 'a', rowIndex: 0 },
      { rowKey: '1', colKey: 'b', rowIndex: 0 },
      { rowKey: '2', colKey: 'a', rowIndex: 1 },
      { rowKey: '2', colKey: 'b', rowIndex: 1 },
    ]
    expect(navigateEditableCell(cells, '1', 'a', 'next', 2)?.colKey).toBe('b')
    expect(navigateEditableCell(cells, '1', 'b', 'next', 2)?.rowKey).toBe('2')
    expect(navigateEditableCell(cells, '1', 'a', 'down', 2)?.rowKey).toBe('2')
    expect(navigateEditableCell(cells, '2', 'b', 'prev', 2)?.colKey).toBe('a')
  })
})
