import { describe, expect, it } from 'vitest'
import { GraphQLBodyError, encodeGraphQL } from './body'

describe('graphql body', () => {
  it('encodes query and variables as json', () => {
    const encoded = encodeGraphQL(
      { query: 'query { ping }', variables: '{"id":1}' },
      (text) => text,
    )
    expect(JSON.parse(encoded.body)).toEqual({ query: 'query { ping }', variables: { id: 1 } })
    expect(encoded.contentType).toContain('application/json')
  })

  it('rejects variables that are not json', () => {
    expect(() => encodeGraphQL({ query: '{ ping }', variables: 'nope' }, (text) => text)).toThrow(GraphQLBodyError)
  })
})
