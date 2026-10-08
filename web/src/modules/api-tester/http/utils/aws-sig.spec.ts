import { describe, expect, it } from 'vitest'
import { applyAwsSigV4 } from './aws-sig'

describe('aws sigv4', () => {
  it('matches the AWS IAM GET example', async () => {
    const headers = new Map<string, string>([
      ['content-type', 'application/x-www-form-urlencoded; charset=utf-8'],
    ])
    await applyAwsSigV4({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers,
      body: '',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'iam',
      now: new Date('2015-08-30T12:36:00Z'),
    })
    expect(headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })
})
