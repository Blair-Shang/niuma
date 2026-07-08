import type { RsContextMenuItem } from '@niuma/ui'
import type { ComposerTranslation } from 'vue-i18n'
import type { FtpPaneEntry, FtpPaneSide } from '@/modules/ftp/composables/useFtpPaneList'

export type FtpContextTarget =
  | { kind: 'pane'; side: FtpPaneSide; selectionCount: number }
  | { kind: 'entry'; side: FtpPaneSide; entry: FtpPaneEntry; selectionCount: number }

export interface FtpContextMenuOptions {
  /** SSH 等无本地栏场景：在远程面板提供上传入口 */
  remoteUpload?: boolean
}

function buildPaneItems(
  target: Extract<FtpContextTarget, { kind: 'pane' }>,
  t: ComposerTranslation,
  options?: FtpContextMenuOptions,
): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'refresh', label: t('modules.ftp.session.refresh'), icon: 'refresh-cw', shortcut: 'F5' },
    { key: 'mkdir', label: t('modules.ftp.session.mkdir'), icon: 'folder-plus' },
  ]
  if (target.side === 'remote' && options?.remoteUpload) {
    items.push({ key: 'upload-pane', label: t('modules.ftp.session.upload'), icon: 'upload' })
    items.push({ key: 'upload-folder-pane', label: t('modules.ftp.session.uploadFolder'), icon: 'folder-up' })
  }
  if (target.selectionCount === 0) {
    return items
  }
  items.push({ key: 'sep-sel', label: '', separator: true })
  if (target.side === 'local') {
    items.push(
      {
        key: 'upload-selected',
        label: t('modules.ftp.session.uploadSelected', { count: target.selectionCount }),
        icon: 'upload',
      },
      {
        key: 'delete-selected',
        label: t('modules.ftp.session.deleteSelected', { count: target.selectionCount }),
        icon: 'trash-2',
        danger: true,
      },
    )
  } else {
    items.push(
      {
        key: 'download-selected',
        label: t('modules.ftp.session.downloadSelected', { count: target.selectionCount }),
        icon: 'download',
      },
      {
        key: 'delete-selected',
        label: t('modules.ftp.session.deleteSelected', { count: target.selectionCount }),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return items
}

function buildSingleEntryItems(
  side: FtpPaneSide,
  entry: FtpPaneEntry,
  t: ComposerTranslation,
  options?: FtpContextMenuOptions,
): RsContextMenuItem[] {
  const isDir = entry.kind === 'dir'
  const head: RsContextMenuItem[] = []

  if (isDir) {
    head.push({ key: 'open', label: t('modules.ftp.session.open'), icon: 'folder-open' })
    if (side === 'local') {
      head.push({ key: 'upload', label: t('modules.ftp.session.upload'), icon: 'upload' })
    } else {
      head.push({ key: 'download', label: t('modules.ftp.session.download'), icon: 'download' })
      if (options?.remoteUpload) {
        head.push({ key: 'upload', label: t('modules.ftp.session.upload'), icon: 'upload' })
      }
    }
  } else if (side === 'local') {
    head.push({ key: 'upload', label: t('modules.ftp.session.upload'), icon: 'upload' })
  } else {
    head.push({ key: 'download', label: t('modules.ftp.session.download'), icon: 'download' })
    if (options?.remoteUpload) {
      head.push({ key: 'upload', label: t('modules.ftp.session.upload'), icon: 'upload' })
    }
  }

  if (side === 'local' && !isDir) {
    head.push(
      {
        key: 'show-in-folder',
        label: t('modules.ftp.session.showInFolder'),
        icon: 'folder-search',
      },
      { key: 'open-in-editor', label: t('modules.ftp.session.onlineEdit'), icon: 'file-pen' },
    )
  } else if (!isDir) {
    head.push({ key: 'open-in-editor', label: t('modules.ftp.session.onlineEdit'), icon: 'file-pen' })
  }

  head.push(
    { key: 'rename', label: t('modules.ftp.session.rename'), icon: 'pencil' },
    { key: 'delete', label: t('modules.ftp.session.delete'), icon: 'trash-2', danger: true, shortcut: 'Del' },
    { key: 'sep-1', label: '', separator: true },
    { key: 'copy-path', label: t('modules.ftp.session.copyPath'), icon: 'copy' },
    { key: 'sep-2', label: '', separator: true },
    { key: 'refresh', label: t('modules.ftp.session.refresh'), icon: 'refresh-cw', shortcut: 'F5' },
  )

  if (isDir) {
    head.push({ key: 'mkdir', label: t('modules.ftp.session.mkdir'), icon: 'folder-plus' })
  }

  return head
}

function buildMultiEntryItems(
  side: FtpPaneSide,
  selectionCount: number,
  t: ComposerTranslation,
): RsContextMenuItem[] {
  if (side === 'local') {
    return [
      {
        key: 'upload-selected',
        label: t('modules.ftp.session.uploadSelected', { count: selectionCount }),
        icon: 'upload',
      },
      {
        key: 'delete-selected',
        label: t('modules.ftp.session.deleteSelected', { count: selectionCount }),
        icon: 'trash-2',
        danger: true,
      },
      { key: 'sep-1', label: '', separator: true },
      { key: 'refresh', label: t('modules.ftp.session.refresh'), icon: 'refresh-cw', shortcut: 'F5' },
    ]
  }
  return [
    {
      key: 'download-selected',
      label: t('modules.ftp.session.downloadSelected', { count: selectionCount }),
      icon: 'download',
    },
    {
      key: 'delete-selected',
      label: t('modules.ftp.session.deleteSelected', { count: selectionCount }),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-1', label: '', separator: true },
    { key: 'refresh', label: t('modules.ftp.session.refresh'), icon: 'refresh-cw', shortcut: 'F5' },
  ]
}

export function buildFtpContextMenuItems(
  target: FtpContextTarget,
  t: ComposerTranslation,
  options?: FtpContextMenuOptions,
): RsContextMenuItem[] {
  if (target.kind === 'pane') {
    return buildPaneItems(target, t, options)
  }
  const { side, entry, selectionCount } = target
  if (selectionCount > 1) {
    return buildMultiEntryItems(side, selectionCount, t)
  }
  return buildSingleEntryItems(side, entry, t, options)
}
