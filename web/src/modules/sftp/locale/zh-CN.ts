export default {
  modules: {
    sftp: {
      title: 'SFTP',
      desc: '仅 SFTP 文件传输，不需要 SSH 终端权限。',
      homeDesc: '选择站点连接后即可浏览与传输远程文件；账号只需 SFTP 权限，不必有 shell。',
      newSite: '新建站点',
      editSite: '编辑站点',
      empty: '暂无 SFTP 站点，点击「新建站点」添加。',
      loadError: '加载 SFTP 站点失败',
      session: {
        connectError: '连接 SFTP 服务器失败',
        listError: '读取远程目录失败',
      },
    },
  },
}
