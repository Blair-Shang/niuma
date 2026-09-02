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
import sqliteZh from '../modules/sqlite/locale/zh-CN'
import sqliteEn from '../modules/sqlite/locale/en-US'
import damengZh from '../modules/dameng/locale/zh-CN'
import damengEn from '../modules/dameng/locale/en-US'
import oracleZh from '../modules/oracle/locale/zh-CN'
import oracleEn from '../modules/oracle/locale/en-US'
import clickhouseZh from '../modules/clickhouse/locale/zh-CN'
import clickhouseEn from '../modules/clickhouse/locale/en-US'
import kingbaseZh from '../modules/kingbase/locale/zh-CN'
import kingbaseEn from '../modules/kingbase/locale/en-US'
import sqlserverZh from '../modules/sqlserver/locale/zh-CN'
import sqlserverEn from '../modules/sqlserver/locale/en-US'
import postgresZh from '../modules/postgres/locale/zh-CN'
import postgresEn from '../modules/postgres/locale/en-US'
import apiZh from '../modules/api-tester/locale/zh-CN'
import apiEn from '../modules/api-tester/locale/en-US'

const zhMessages = mergeMessages(
  zhCN,
  sshZh,
  ftpZh,
  redisZh,
  mongodbZh,
  mysqlZh,
  vastbaseZh,
  sqliteZh,
  damengZh,
  oracleZh,
  clickhouseZh,
  kingbaseZh,
  sqlserverZh,
  postgresZh,
  apiZh,
) as typeof zhCN

const enMessages = mergeMessages(
  enUS,
  sshEn,
  ftpEn,
  redisEn,
  mongodbEn,
  mysqlEn,
  vastbaseEn,
  sqliteEn,
  damengEn,
  oracleEn,
  clickhouseEn,
  kingbaseEn,
  sqlserverEn,
  postgresEn,
  apiEn,
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
