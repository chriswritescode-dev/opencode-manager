import { describe, it, expect } from 'vitest'
import { parseGitError } from '../../src/utils/git-errors'

describe('parseGitError', () => {
  describe('AUTH_FAILED', () => {
    it('matches HTTPS authentication failure', () => {
      const error = new Error(
        'Command failed with code 128: fatal: Authentication failed for \'https://github.com/user/repo.git\''
      )
      const result = parseGitError(error)
      expect(result.code).toBe('AUTH_FAILED')
      expect(result.statusCode).toBe(401)
    })

    it('matches SSH could not read Username', () => {
      const error = new Error(
        'Command failed with code 128: fatal: could not read Username for \'https://github.com\': terminal prompts disabled'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('AUTH_FAILED')
      expect(result.statusCode).toBe(401)
    })
  })

  describe('REPO_NOT_FOUND', () => {
    it('matches GitHub 404', () => {
      const error = new Error(
        'Command failed with code 128: remote: Repository not found.\nfatal: repository \'https://github.com/user/nonexistent.git/\' not found'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('REPO_NOT_FOUND')
      expect(result.statusCode).toBe(404)
    })

    it('matches DNS failure', () => {
      const error = new Error(
        'Command failed with code 128: fatal: unable to access \'https://notahost.example/repo.git/\': Could not resolve host: notahost.example'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('REPO_NOT_FOUND')
      expect(result.statusCode).toBe(404)
    })
  })

  describe('PERMISSION_DENIED', () => {
    it('matches SSH permission denied', () => {
      const error = new Error(
        'Command failed with code 128: git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('PERMISSION_DENIED')
      expect(result.statusCode).toBe(403)
    })
  })

  describe('PUSH_REJECTED', () => {
    it('matches non-fast-forward push rejection with progress lines', () => {
      const error = new Error(
        'Command failed with code 1: To github.com:user/repo.git\n' +
        ' ! [rejected]        main -> main (non-fast-forward)\n' +
        'error: failed to push some refs to \'github.com:user/repo.git\'\n' +
        'hint: Updates were rejected because the tip of your current branch is behind\n' +
        'hint: its remote counterpart.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('PUSH_REJECTED')
      expect(result.statusCode).toBe(409)
      expect(result.detail).toContain('[rejected]')
      expect(result.detail).toContain('non-fast-forward')
    })

    it('matches fetch-first rejection', () => {
      const error = new Error(
        'Command failed with code 1: error: failed to push some refs\n' +
        'hint: Updates were rejected because the remote contains work that you do\n' +
        'hint: not have locally. Integrate the remote changes before pushing again.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('PUSH_REJECTED')
    })
  })

  describe('MERGE_CONFLICT', () => {
    it('matches actual merge conflict output', () => {
      const error = new Error(
        'Command failed with code 1: Auto-merging README.md\n' +
        'CONFLICT (content): Merge conflict in README.md\n' +
        'Automatic merge failed; fix conflicts and then commit the result.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('MERGE_CONFLICT')
      expect(result.statusCode).toBe(409)
    })

    it('does NOT false-positive on Auto-merging without CONFLICT', () => {
      const error = new Error(
        'Command failed with code 1: Auto-merging README.md\n' +
        'error: some other unrelated failure occurred'
      )
      const result = parseGitError(error)
      expect(result.code).not.toBe('MERGE_CONFLICT')
    })
  })

  describe('NO_UPSTREAM', () => {
    it('matches no upstream branch error', () => {
      const error = new Error(
        'Command failed with code 128: fatal: The current branch feature-xyz has no upstream branch.\n' +
        'To push the current branch and set the remote as upstream, use\n' +
        '\n' +
        '    git push --set-upstream origin feature-xyz'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('NO_UPSTREAM')
      expect(result.statusCode).toBe(400)
    })
  })

  describe('TIMEOUT', () => {
    it('matches executeCommand timeout format', () => {
      const error = new Error('Command timed out after 30000ms: git -C /path/to/repo push')
      const result = parseGitError(error)
      expect(result.code).toBe('TIMEOUT')
      expect(result.statusCode).toBe(504)
    })
  })

  describe('NOT_A_REPO', () => {
    it('matches not a git repository', () => {
      const error = new Error(
        'Command failed with code 128: fatal: not a git repository (or any of the parent directories): .git'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('NOT_A_REPO')
      expect(result.statusCode).toBe(400)
    })
  })

  describe('LOCK_FAILED', () => {
    it('matches index.lock error', () => {
      const error = new Error(
        'Command failed with code 128: fatal: Unable to create \'/path/.git/index.lock\': File exists.\n\n' +
        'Another git process seems to be running in this repository.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('LOCK_FAILED')
      expect(result.statusCode).toBe(409)
    })
  })

  describe('BRANCH_EXISTS', () => {
    it('matches branch already exists', () => {
      const error = new Error(
        'Command failed with code 128: fatal: A branch named \'feature\' already exists.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('BRANCH_EXISTS')
      expect(result.statusCode).toBe(409)
    })
  })

  describe('BRANCH_NOT_FOUND', () => {
    it('matches pathspec did not match', () => {
      const error = new Error(
        'Command failed with code 1: error: pathspec \'nonexistent\' did not match any file(s) known to git'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('BRANCH_NOT_FOUND')
      expect(result.statusCode).toBe(404)
    })
  })

  describe('UNCOMMITTED_CHANGES', () => {
    it('matches local changes would be overwritten', () => {
      const error = new Error(
        'Command failed with code 1: error: Your local changes to the following files would be overwritten by merge:\n' +
        '\tREADME.md\n' +
        'Please commit your changes or stash them before you merge.'
      )
      const result = parseGitError(error)
      expect(result.code).toBe('UNCOMMITTED_CHANGES')
      expect(result.statusCode).toBe(409)
    })
  })

  describe('UNKNOWN', () => {
    it('falls back for unrecognized errors', () => {
      const error = new Error('Command failed with code 1: something completely unexpected happened')
      const result = parseGitError(error)
      expect(result.code).toBe('UNKNOWN')
      expect(result.statusCode).toBe(500)
      expect(result.summary).toBe('A git operation failed.')
      expect(result.detail).toBe('something completely unexpected happened')
    })

    it('handles non-Error input', () => {
      const result = parseGitError('a string error')
      expect(result.code).toBe('UNKNOWN')
      expect(result.detail).toBe('a string error')
    })

    it('handles object with message', () => {
      const result = parseGitError({ message: 'object error' })
      expect(result.code).toBe('UNKNOWN')
      expect(result.detail).toBe('object error')
    })
  })

  describe('prefix stripping', () => {
    it('strips Command failed prefix', () => {
      const error = new Error('Command failed with code 128: fatal: not a git repository')
      const result = parseGitError(error)
      expect(result.detail).not.toContain('Command failed with code')
    })

    it('handles errors without prefix', () => {
      const error = new Error('Repository not found')
      const result = parseGitError(error)
      expect(result.code).toBe('REPO_NOT_FOUND')
    })
  })

  describe('progress line cleaning', () => {
    it('strips remote progress lines from detail', () => {
      const error = new Error(
        'Command failed with code 128: remote: Counting objects: 100% (10/10), done.\n' +
        'remote: Compressing objects: 100% (5/5), done.\n' +
        'remote: Total 10 (delta 3), reused 10 (delta 3)\n' +
        'fatal: Authentication failed for \'https://github.com/user/repo.git\''
      )
      const result = parseGitError(error)
      expect(result.code).toBe('AUTH_FAILED')
      expect(result.detail).not.toContain('Counting objects')
      expect(result.detail).not.toContain('Compressing objects')
      expect(result.detail).toContain('Authentication failed')
    })

    it('preserves rejection lines in detail', () => {
      const error = new Error(
        'Command failed with code 1: To github.com:user/repo.git\n' +
        ' ! [rejected]        main -> main (non-fast-forward)\n' +
        'error: failed to push some refs'
      )
      const result = parseGitError(error)
      expect(result.detail).toContain('[rejected]')
      expect(result.detail).toContain('main -> main')
    })

    it('strips tracking branch lines but not error lines with arrows', () => {
      const error = new Error(
        'Command failed with code 128: From github.com:user/repo\n' +
        ' * [new branch]      dev        -> origin/dev\n' +
        '   abc1234..def5678  main       -> origin/main\n' +
        'fatal: not a git repository'
      )
      const result = parseGitError(error)
      expect(result.detail).not.toContain('origin/dev')
      expect(result.detail).not.toContain('abc1234..def5678')
      expect(result.detail).toContain('not a git repository')
    })

    it('collapses excessive blank lines', () => {
      const error = new Error(
        'Command failed with code 1: remote: Counting objects: done.\n\n\nfatal: error message here'
      )
      const result = parseGitError(error)
      const consecutiveNewlines = result.detail.match(/\n{3,}/g)
      expect(consecutiveNewlines).toBeNull()
    })
  })

  describe('GitService plain Error passthrough', () => {
    it('handles GitService "Repository not found" throw', () => {
      const error = new Error('Repository not found')
      const result = parseGitError(error)
      expect(result.code).toBe('REPO_NOT_FOUND')
      expect(result.statusCode).toBe(404)
    })

    it('handles GitService "Unable to detect current branch" as UNKNOWN', () => {
      const error = new Error('Unable to detect current branch. Ensure you are on a branch before pushing with --set-upstream.')
      const result = parseGitError(error)
      expect(result.code).toBe('UNKNOWN')
    })
  })
})
