import { describe, expect, it } from 'vitest'
import {
  extractPromptPath,
  joinHomeRelative,
  normalizeRemoteCwd,
  parseItermCurrentDir,
  parseOsc7Payload,
} from './terminal-cwd'

describe('terminal-cwd', () => {
  it('normalizes unix and tilde paths', () => {
    expect(normalizeRemoteCwd('/var/www')).toBe('/var/www')
    expect(normalizeRemoteCwd('~/src')).toBe('~/src')
    expect(normalizeRemoteCwd('~')).toBe('~')
    expect(normalizeRemoteCwd('/var//www')).toBe('/var/www')
    expect(normalizeRemoteCwd('relative')).toBeNull()
    expect(normalizeRemoteCwd('')).toBeNull()
  })

  it('parses OSC 7 file URLs', () => {
    expect(parseOsc7Payload('file://host/var/www')).toBe('/var/www')
    expect(parseOsc7Payload('file:///home/niuma')).toBe('/home/niuma')
    expect(parseOsc7Payload('file://localhost/tmp/a%20b')).toBe('/tmp/a b')
    expect(parseOsc7Payload('https://example.com')).toBeNull()
  })

  it('parses iTerm CurrentDir', () => {
    expect(parseItermCurrentDir('CurrentDir=/opt/app')).toBe('/opt/app')
    expect(parseItermCurrentDir('CurrentDir=~/code')).toBe('~/code')
    expect(parseItermCurrentDir('RemoteHost=box')).toBeNull()
  })

  it('extracts paths from common prompts', () => {
    expect(extractPromptPath('niuma@box:/var/www$')).toBe('/var/www')
    expect(extractPromptPath('root@box:~/src# ls')).toBe('~/src')
    expect(extractPromptPath('[root@localhost /etc]#')).toBe('/etc')
    expect(extractPromptPath('[niuma@box ~/code]$ make')).toBe('~/code')
    expect(extractPromptPath('(base) niuma@box:/opt$')).toBe('/opt')
    expect(extractPromptPath('[niuma@box src]$')).toBeNull()
  })

  it('joins tilde against SFTP home', () => {
    expect(joinHomeRelative('/home/niuma', '~')).toBe('/home/niuma')
    expect(joinHomeRelative('/home/niuma', '~/src')).toBe('/home/niuma/src')
    expect(joinHomeRelative('/home/niuma/', '~/a/b')).toBe('/home/niuma/a/b')
  })
})
