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

  it('rebuilds schedule jobs for cron support in v8', () => {
    const db = {
      prepare: vi.fn().mockReturnValue({
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
      }),
      run: vi.fn(),
    }

    migration008.up(db as never)

    expect(db.prepare).toHaveBeenCalledWith('PRAGMA table_info(schedule_jobs)')
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE schedule_jobs_new'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('interval_minutes INTEGER,'))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("schedule_mode TEXT NOT NULL DEFAULT 'interval'"))
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("'interval'"))
    expect(db.run).toHaveBeenCalledWith('DROP TABLE schedule_jobs')
    expect(db.run).toHaveBeenCalledWith('ALTER TABLE schedule_jobs_new RENAME TO schedule_jobs')
  })
})
