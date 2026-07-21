import { mongodbApi } from '@/api'
import type {
  MongoAuthMechanism,
  MongoClientDriver,
  MongoConnectionOptions,
  MongoReadPreference,
  MongoSessionTestParams,
  MongoTopology,
} from '@/api/types/mongodb'
import { DEFAULT_MONGO_OPTIONS } from '@/api/types/mongodb'
import {
  applyStoredTimeout,
  basePasswordSecret,
  buildTimeoutSeconds,
  passwordCredentialKind,
} from '@/modules/ops/connection-form/adapter-helpers'
import {
  formStr,
  type ConnectionFormAdapter,
  type ConnectionTestParams,
} from '@/modules/ops/connection-form/types'
import {
  cappedTestTimeout,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'

export const mongodbConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    mongoTopology: DEFAULT_MONGO_OPTIONS.topology,
    mongoAuthMechanism: DEFAULT_MONGO_OPTIONS.auth_mechanism,
    mongoAuthDatabase: DEFAULT_MONGO_OPTIONS.auth_database,
    mongoReplicaSet: DEFAULT_MONGO_OPTIONS.replica_set,
    mongoReadPreference: DEFAULT_MONGO_OPTIONS.read_preference,
    mongoSrvRecord: 'false',
    mongoClientDriver: DEFAULT_MONGO_OPTIONS.client_driver,
    mongoDefaultDatabase: DEFAULT_MONGO_OPTIONS.default_database,
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as MongoConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.mongoTopology = opts?.topology ?? DEFAULT_MONGO_OPTIONS.topology
    form.mongoAuthMechanism = opts?.auth_mechanism ?? DEFAULT_MONGO_OPTIONS.auth_mechanism
    form.mongoAuthDatabase = opts?.auth_database ?? DEFAULT_MONGO_OPTIONS.auth_database
    form.mongoReplicaSet = opts?.replica_set ?? ''
    form.mongoReadPreference = opts?.read_preference ?? DEFAULT_MONGO_OPTIONS.read_preference
    form.mongoSrvRecord = String(opts?.srv_record ?? false)
    form.mongoClientDriver = opts?.client_driver ?? DEFAULT_MONGO_OPTIONS.client_driver
    form.mongoDefaultDatabase = opts?.default_database ?? ''
    applyStoredTimeout(form, raw, DEFAULT_MONGO_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_MONGO_OPTIONS,
      ...accent,
      topology: formStr(form, 'mongoTopology', DEFAULT_MONGO_OPTIONS.topology) as MongoTopology,
      auth_mechanism: formStr(
        form,
        'mongoAuthMechanism',
        DEFAULT_MONGO_OPTIONS.auth_mechanism,
      ) as MongoAuthMechanism,
      auth_database:
        formStr(form, 'mongoAuthDatabase').trim() || DEFAULT_MONGO_OPTIONS.auth_database,
      replica_set: formStr(form, 'mongoReplicaSet').trim(),
      read_preference: formStr(
        form,
        'mongoReadPreference',
        DEFAULT_MONGO_OPTIONS.read_preference,
      ) as MongoReadPreference,
      srv_record: formStr(form, 'mongoSrvRecord') === 'true',
      client_driver: formStr(
        form,
        'mongoClientDriver',
        DEFAULT_MONGO_OPTIONS.client_driver,
      ) as MongoClientDriver,
      default_database: formStr(form, 'mongoDefaultDatabase').trim(),
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_MONGO_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as MongoConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(raw, DEFAULT_MONGO_OPTIONS.timeout_seconds),
          DEFAULT_MONGO_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return mongodbApi.sessionTest(params as MongoSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => false,
  credentialKind: passwordCredentialKind,
}
