import { describe, expect, it, vi } from 'vitest'
import migration007 from '../../src/db/migrations/007-schedules'
import migration008 from '../../src/db/migrations/008-schedule-cron-support'

describe('schedule migrations', () => {
  it('creates schedule jobs with nullable interval minutes in v7', () => {
    const db = {
      run: vi.fn(),
    }

    migration007.up(db as never)

    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('interval_minutes INTEGER,'))
  })

  it('creates tables from scratch when schedule_jobs does not exist (phantom migration)', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info')) {
          return {
            all: vi.fn().mockReturnValue([
              { name: 'interval_minutes', notnull: 0, dflt_value: null },
              { name: 'schedule_mode', notnull: 1, dflt_value: "'interval'" },
              { name: 'cron_expression', notnull: 0, dflt_value: null },
              { name: 'timezone', notnull: 0, dflt_value: null },
            ]),
          }
        }
        return { get: vi.fn().mockReturnValue(undefined) }
      }),
      run: vi.fn(),
    }

    migration008.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_jobs'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('schedule_mode TEXT NOT NULL DEFAULT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('cron_expression TEXT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('timezone TEXT'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_runs'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('idx_schedule_jobs_repo'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('idx_schedule_jobs_next_run'))
  })

  it('rebuilds schedule jobs for cron support in v8', () => {
    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          return {
            get: vi.fn().mockReturnValue({ name: 'schedule_jobs' }),
          }
        }
        return {
          all: vi.fn().mockReturnValue([
            { name: 'id', notnull: 0, dflt_value: null },
            { name: 'repo_id', notnull: 1, dflt_value: null },
            { name: 'name', notnull: 1, dflt_value: null },
            { name: 'description', notnull: 0, dflt_value: null },
            { name: 'enabled', notnull: 1, dflt_value: 'TRUE' },
            { name: 'interval_minutes', notnull: 1, dflt_value: null },
            { name: 'agent_slug', notnull: 0, dflt_value: null },
            { name: 'prompt', notnull: 1, dflt_value: null },
            { name: 'model', notnull: 0, dflt_value: null },
            { name: 'skill_metadata', notnull: 0, dflt_value: null },
            { name: 'created_at', notnull: 1, dflt_value: null },
            { name: 'updated_at', notnull: 1, dflt_value: null },
            { name: 'last_run_at', notnull: 0, dflt_value: null },
            { name: 'next_run_at', notnull: 0, dflt_value: null },
          ]),
        }
      }),
      run: vi.fn(),
    }

    migration008.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'))
    expect(db.prepare).toHaveBeenCalledWith('PRAGMA table_info(schedule_jobs)')
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_jobs_new'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('interval_minutes INTEGER,'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("schedule_mode TEXT NOT NULL DEFAULT 'interval'"))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("'interval'"))
    expect(db.run).toHaveBeenCalledWith('DROP TABLE schedule_jobs')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_jobs_new RENAME TO schedule_jobs')
  })
})
