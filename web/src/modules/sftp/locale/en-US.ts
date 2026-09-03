export default {
  modules: {
    sftp: {
      title: 'SFTP',
      desc: 'SFTP file transfer only — no SSH shell required.',
      homeDesc: 'Select a site to browse and transfer remote files. The account only needs SFTP access, not a shell.',
      newSite: 'New site',
      editSite: 'Edit site',
      empty: 'No SFTP sites yet. Click "New site" to add one.',
      loadError: 'Failed to load SFTP sites',
      session: {
        connectError: 'Failed to connect to SFTP server',
        listError: 'Failed to list remote directory',
      },
    },
  },
}
