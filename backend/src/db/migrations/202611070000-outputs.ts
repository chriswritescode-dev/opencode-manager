import type { Migration } from '../migration-runner'

const migration: Migration = {
  id: '202611070000-outputs',

  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS output_definitions (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        definition TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, id)
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS outputs (
        session_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        params_key TEXT NOT NULL,
        params TEXT NOT NULL,
        input_hash TEXT,
        generation_id TEXT NOT NULL,
        generator_session_id TEXT,
        status TEXT NOT NULL,
        output_dir TEXT,
        published_at INTEGER,
        execution_started_at INTEGER,
        error TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, definition_id, params_key)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS outputs_generator_session ON outputs(generator_session_id)')
  },

  down(db) {
    db.run('DROP INDEX IF EXISTS outputs_generator_session')
    db.run('DROP TABLE IF EXISTS outputs')
    db.run('DROP TABLE IF EXISTS output_definitions')
  },
}

export default migration
