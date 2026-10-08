/**
 * GraphQL 正文。查询和变量留在请求上，发送前才编成 JSON。
 */
import type { ApiGraphQLBody } from '../../types'

export class GraphQLBodyError extends Error {
  constructor() {
    super('graphql-variables')
    this.name = 'GraphQLBodyError'
  }
}

export function emptyGraphQL(): ApiGraphQLBody {
  return { query: '', variables: '' }
}

/** GraphQL 内省查询。用来把 schema 拉回工作台。 */
export const INTROSPECTION_QUERY = `query Introspection {
  __schema {
    queryType { name }
    mutationType { name }
    types { kind name }
  }
}`

export function normalizeGraphQL(raw: unknown): ApiGraphQLBody {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    query: typeof item.query === 'string' ? item.query : '',
    variables: typeof item.variables === 'string' ? item.variables : '',
  }
}

/** 编成 Postman 同款 `{ query, variables }`。变量不是 JSON 时抛出。 */
export function encodeGraphQL(
  graphql: ApiGraphQLBody | undefined,
  interpolate: (text: string) => string,
): { body: string; contentType: string } {
  const source = graphql ?? emptyGraphQL()
  const query = interpolate(source.query)
  const raw = interpolate(source.variables).trim()
  let variables: unknown = {}
  if (raw) {
    try {
      variables = JSON.parse(raw) as unknown
    } catch {
      throw new GraphQLBodyError()
    }
  }
  return {
    body: JSON.stringify({ query, variables }),
    contentType: 'application/json; charset=utf-8',
  }
}
