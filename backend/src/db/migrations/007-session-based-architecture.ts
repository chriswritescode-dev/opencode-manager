import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 7,
  name: 'session-based-architecture',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS devcontainer_templates (
        name TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        dockerfile TEXT,
        forked_from TEXT,
        is_built_in BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        
        FOREIGN KEY (forked_from) REFERENCES devcontainer_templates(name)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        
        opencode_container_id TEXT,
        dind_container_id TEXT,
        code_server_container_id TEXT,
        
        internal_hostname TEXT NOT NULL,
        opencode_url TEXT NOT NULL,
        code_server_url TEXT NOT NULL,
        public_opencode_url TEXT,
        
        session_path TEXT NOT NULL,
        opencode_state_path TEXT NOT NULL,
        dind_data_path TEXT NOT NULL,
        code_server_config_path TEXT NOT NULL,
        
        devcontainer_template TEXT NOT NULL,
        devcontainer_config_hash TEXT NOT NULL,
        
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        metadata TEXT,
        
        FOREIGN KEY (devcontainer_template) REFERENCES devcontainer_templates(name)
      );

      CREATE TABLE IF NOT EXISTS session_repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        repo_id INTEGER NOT NULL,
        repo_name TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        symlink_path TEXT NOT NULL,
        container_path TEXT NOT NULL,
        branch TEXT,
        
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE RESTRICT,
        UNIQUE(session_id, repo_id, branch)
      );

      CREATE TABLE IF NOT EXISTS template_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        
        FOREIGN KEY (template_name) REFERENCES devcontainer_templates(name),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS devcontainer_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        template_name TEXT,
        requested_by TEXT NOT NULL,
        changes TEXT NOT NULL,
        reason TEXT,
        action TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (template_name) REFERENCES devcontainer_templates(name)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_session_repos_session_id ON session_repos(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_repos_repo_id ON session_repos(repo_id);
      CREATE INDEX IF NOT EXISTS idx_template_usage_template ON template_usage(template_name);
      CREATE INDEX IF NOT EXISTS idx_template_usage_session ON template_usage(session_id);
    `)

    db.exec(`
      ALTER TABLE repos ADD COLUMN recommended_devcontainer TEXT;
      ALTER TABLE repos ADD COLUMN devcontainer_history TEXT;
    `)
  },

  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_template_usage_session;
      DROP INDEX IF EXISTS idx_template_usage_template;
      DROP INDEX IF EXISTS idx_session_repos_repo_id;
      DROP INDEX IF EXISTS idx_session_repos_session_id;
      DROP INDEX IF EXISTS idx_sessions_status;
      DROP INDEX IF EXISTS idx_sessions_name;
      
      DROP TABLE IF EXISTS devcontainer_requests;
      DROP TABLE IF EXISTS template_usage;
      DROP TABLE IF EXISTS session_repos;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS devcontainer_templates;
    `)
  },
}

export default migration
