import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'
import { mergeMessages } from './merge-messages'

import sshZh from '../modules/ssh/locale/zh-CN'
import sshEn from '../modules/ssh/locale/en-US'
import ftpZh from '../modules/ftp/locale/zh-CN'
import ftpEn from '../modules/ftp/locale/en-US'
import redisZh from '../modules/redis/locale/zh-CN'
import redisEn from '../modules/redis/locale/en-US'
import mongodbZh from '../modules/mongodb/locale/zh-CN'
import mongodbEn from '../modules/mongodb/locale/en-US'
import mysqlZh from '../modules/mysql/locale/zh-CN'
import mysqlEn from '../modules/mysql/locale/en-US'
import vastbaseZh from '../modules/vastbase/locale/zh-CN'
import vastbaseEn from '../modules/vastbase/locale/en-US'

const zhMessages = mergeMessages(
  zhCN,
  sshZh,
  ftpZh,
  redisZh,
  mongodbZh,
  mysqlZh,
  vastbaseZh,
) as typeof zhCN

const enMessages = mergeMessages(
  enUS,
  sshEn,
  ftpEn,
  redisEn,
  mongodbEn,
  mysqlEn,
  vastbaseEn,
) as typeof enUS

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhMessages,
    'en-US': enMessages,
  },
})
