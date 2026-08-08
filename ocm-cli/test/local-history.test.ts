import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveOpencodeDbPath } from '../src/local-history.js'

describe('resolveOpencodeDbPath', () => {
  let dataHome: string
  let dataDir: string
  const savedEnv = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENCODE_DB: process.env.OPENCODE_DB }

  beforeEach(() => {
    dataHome = mkdtempSync(join(tmpdir(), 'ocm-dbpath-'))
    dataDir = join(dataHome, 'opencode')
    mkdirSync(dataDir)
    process.env.XDG_DATA_HOME = dataHome
    delete process.env.OPENCODE_DB
  })

  afterEach(() => {
    rmSync(dataHome, { recursive: true, force: true })
    if (savedEnv.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = savedEnv.XDG_DATA_HOME
    if (savedEnv.OPENCODE_DB === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = savedEnv.OPENCODE_DB
  })

  it('honours an absolute OPENCODE_DB override', () => {
    process.env.OPENCODE_DB = '/tmp/custom.db'
    expect(resolveOpencodeDbPath()).toBe('/tmp/custom.db')
  })

  it('resolves a relative OPENCODE_DB override against the data dir', () => {
    process.env.OPENCODE_DB = 'custom.db'
    expect(resolveOpencodeDbPath()).toBe(join(dataDir, 'custom.db'))
  })

  it('prefers the default opencode.db when present', () => {
    writeFileSync(join(dataDir, 'opencode.db'), '', { flag: 'w' })
    writeFileSync(join(dataDir, 'opencode-dev.db'), '')
    expect(resolveOpencodeDbPath()).toBe(join(dataDir, 'opencode.db'))
  })

  it('falls back to the newest channel variant', () => {
    const older = join(dataDir, 'opencode-old.db')
    const newer = join(dataDir, 'opencode-dev.db')
    writeFileSync(older, '')
    writeFileSync(newer, '')
    utimesSync(older, new Date('2024-01-01'), new Date('2024-01-01'))
    expect(resolveOpencodeDbPath()).toBe(newer)
  })
})
