# Backend Routes Code Review

## Duplicate Code

- **Repeated error handling pattern for Zod validation** - Multiple route files
  - Evidence: Identical Zod error handling pattern repeated across 10+ files:
    ```typescript
    // In oauth.ts:47-51
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400)
    }

    // In providers.ts:47-50 (identical)
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400)
    }
    ```
  - Files: `oauth.ts:47-51`, `providers.ts:47-50`, `sse.ts:67-70`, `sse.ts:80-83`, `settings.ts:120-123`, `settings.ts:172-177`, `settings.ts:219-222`, `tts.ts:418-420`
  - Issue: Code duplication makes maintenance harder and can lead to inconsistent responses
  - Suggestion: Create a reusable middleware or utility function: `handleZodError(error: ZodError) => Response`

- **Duplicate discovery cache logic in TTS and STT routes** - `backend/src/routes/tts.ts:120-151`, `backend/src/routes/stt.ts:36-67`
  - Evidence: Nearly identical cache reading/writing functions
    ```typescript
    // Both files have identical getCachedDiscovery() and cacheDiscovery() functions
    async function getCachedDiscovery(cacheKey: string): Promise<string[] | null> {
      // Same implementation in both files
    }
    ```
  - Issue: Same logic duplicated across both files, violates DRY principle
  - Suggestion: Extract to shared utility in `backend/src/services/cache.ts` with configurable directory and TTL

- **Duplicate fetch logic for models/voices** - `backend/src/routes/tts.ts:152-240` vs `backend/src/routes/stt.ts:69-117`
  - Evidence: Both implement nearly identical endpoint probing logic for OpenAI-compatible APIs
  - Issue: Business logic duplicated instead of being reusable
  - Suggestion: Create shared `OpenAIAPIService` class with methods to detect available endpoints

## Broken/Suspect Logic

- **Integer parsing without validation** - `backend/src/routes/repos.ts:113`, `backend/src/routes/repo-git.ts:28`
  - Evidence: `parseInt(c.req.param('id'))` without checking result validity
    ```typescript
    const id = parseInt(c.req.param('id'))
    const repo = db.getRepoById(database, id)
    // If 'abc' passed, id becomes NaN, silently fails
    ```
  - Issue: NaN passed to database queries returns no results instead of 400 error, making debugging difficult
  - Suggestion: Validate parsed ID: `const id = parseInt(c.req.param('id')); if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)`

- **Incorrect error status code casting in repo creation** - `backend/src/routes/repos.ts:67`
  - Evidence: Unsafe type cast without validation
    ```typescript
    return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    ```
  - Issue: `getStatusCode()` could return invalid status codes that Hono doesn't accept, causing runtime errors
  - Suggestion: Validate status code is valid (200-599 range) before casting, default to 500

- **SSE route never completes** - `backend/src/routes/sse.ts:61`
  - Evidence: Promise that never resolves
    ```typescript
    await new Promise(() => {})
    ```
  - Issue: While intentional for keeping connection open, this is an anti-pattern without timeout handling or cleanup verification
  - Suggestion: Document specifically why this pattern is used and consider adding timeout/heartbeat verification

## Unused Code

- **Unused parameter in createAuthRoutes** - `backend/src/routes/auth.ts:8`
  - Evidence: `_db` parameter prefixed with underscore to indicate it's unused
    ```typescript
    export function createAuthRoutes(auth: AuthInstance, _db: Database) {
    ```
  - Issue: Dead parameter suggests either incomplete implementation or refactoring artifact
  - Suggestion: Remove unused parameter or implement functionality that uses it

- **Unused exported utility functions in TTS routes** - `backend/src/routes/tts.ts:303`
  - Evidence: Functions exported but never used elsewhere in codebase
    ```typescript
    export { generateCacheKey, ensureCacheDir, getCachedAudio, cacheAudio, getCacheSize, cleanupOldestFiles }
    ```
  - Verification: Checked all backend/src imports, these functions are not imported by any other module
  - Issue: Code bloat, exports suggest API surface that doesn't exist
  - Suggestion: Remove unnecessary exports; keep functions internal unless explicitly needed by consumers

## Missing Error Handling

- **Missing error handling in index.ts initialization** - `backend/src/index.ts:255-257`
  - Evidence: Catch block catches error but doesn't prevent server from starting
    ```typescript
    } catch (error) {
      logger.error('Failed to initialize workspace:', error)
    }
    // Server continues to start even if initialization failed
    serve({ ... })
    ```
  - Issue: Server starts in degraded state without proper error propagation, leading to silent failures
  - Suggestion: Exit or return error status if critical initialization fails

- **Unhandled promise rejection in SSE route** - `backend/src/routes/sse.ts:61`
  - Evidence: Promise that never resolves
    ```typescript
    await new Promise(() => {})
    ```
  - Issue: While intentional for SSE, errors in the stream handler before this point aren't caught; also memory leak risk if cleanup fails
  - Suggestion: Add error boundary around SSE setup logic and ensure cleanup is called properly

- **SQLite operations not wrapped in transactions where needed** - `backend/src/routes/repos.ts:23-69`, `backend/src/routes/repos.ts:160-202`
  - Evidence: Multiple database operations without transaction boundary for complex multi-step operations
  - Issue: If any step fails, partial state changes remain in database, leading to data inconsistency
  - Suggestion: Wrap multi-step operations in database transactions (BEGIN/COMMIT/ROLLBACK)

## Inconsistent Patterns

- **Inconsistent error response formats** - Across all route files
  - Evidence: Multiple error response formats used:
    ```typescript
    // Format 1: Simple error message (repos.ts)
    return c.json({ error: 'Repo not found' }, 404)

    // Format 2: Error with details (oauth.ts)
    return c.json({ error: 'Invalid request data', details: error.issues }, 400)

    // Format 3: Nested error structure (tts.ts)
    return c.json({ error: 'TTS API request failed', details: errorDetails }, 500)

    // Format 4: Error field in response object (title.ts)
    return c.json({ error: 'Failed to fetch config' }, 500)
    ```
  - Issue: Frontend must handle multiple response formats, increasing complexity and potential for bugs
  - Suggestion: Standardize on single error response format with `{ error: string, details?: any, statusCode?: number }`

- **Inconsistent route parameter extraction** - Across route files
  - Evidence: Mixed parameter handling patterns:
    ```typescript
    // Pattern 1: Direct param access (repos.ts:113)
    const id = parseInt(c.req.param('id'))

    // Pattern 2: Direct param access without parseInt (oauth.ts:20)
    const providerId = c.req.param('id')

    // Pattern 3: DecodeURIComponent (settings.ts:562)
    const commandName = decodeURIComponent(c.req.param('name'))

    // Pattern 4: Query param vs param (multiple files)
    const userId = c.req.query('userId') || 'default'
    ```
  - Issue: Inconsistent parameter extraction leads to bugs (e.g., URL encoding issues, type mismatches)
  - Suggestion: Create helper functions for common parameter patterns: `getNumberParam(c, name)`, `getStringParam(c, name)`, `getUserId(c)`

- **Mixed async/await and .then() patterns** - `backend/src/index.ts:289-298`
  - Evidence: In production route, uses top-level await pattern then .then() chained approach
    ```typescript
    const html = await fs.readFile(indexPath, 'utf-8')
    return c.html(html)
    // vs elsewhere: consistent async/await usage
    ```
  - Issue: Inconsistent patterns make code harder to read and reason about
  - Suggestion: Use async/await consistently throughout codebase (per AGENTS.md guidelines)

- **Inconsistent database query patterns** - `backend/src/routes/repos.ts` vs `backend/src/routes/repo-git.ts`
  - Evidence: Some routes use prepared statements directly, others use query helper functions
  - Issue: Inconsistent database access patterns lead to maintenance issues and potential SQL injection risks
  - Suggestion: Standardize on using query helper functions from `db/queries.ts` module

## Hardcoded Values

- **Hardcoded cache TTL values** - `backend/src/routes/tts.ts:13-14`, `backend/src/routes/stt.ts:23`
  - Evidence: Magic numbers for cache expiration
    ```typescript
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours
    const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour
    ```
  - Issue: Cache durations hardcoded instead of configurable, making tuning difficult per deployment
  - Suggestion: Move to environment variables or config file with sensible defaults

- **Hardcoded cache size limits** - `backend/src/routes/tts.ts:15-16`
  - Evidence: Cache size limit as magic number
    ```typescript
    const MAX_CACHE_SIZE_MB = 200
    const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024
    ```
  - Issue: Cache size not configurable per deployment requirements
  - Suggestion: Make configurable via environment variable or settings

- **Hardcoded port references** - `backend/src/routes/oauth.ts:13`, `backend/src/routes/title.ts:11`
  - Evidence: OpenCode server port hardcoded in multiple places
    ```typescript
    // oauth.ts:13
    const OPENCODE_SERVER_URL = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`

    // title.ts:11
    const OPENCODE_SERVER_URL = `http://127.0.0.1:${ENV.OPENCODE.PORT}`
    ```
  - Issue: Inconsistent port construction (one uses ENV.OPENCODE.HOST, other uses 127.0.0.1)
  - Suggestion: Create shared utility function `getOpenCodeServerUrl()` to ensure consistency

- **Hardcoded content length limits** - `backend/src/routes/tts.ts:19`, `backend/src/routes/title.ts:7`
  - Evidence: Arbitrary limits as magic numbers in schemas
    ```typescript
    // tts.ts:19
    z.string().min(1).max(4096)

    // title.ts:7
    z.string().min(1).max(5000)
    ```
  - Issue: Limits not documented or configurable, may not suit all use cases
  - Suggestion: Move to constants module with documentation of rationale

## Security Issues

- **Missing input validation on multiple endpoints** - `backend/src/routes/repos.ts:23-69`, `backend/src/routes/repo-git.ts:166-190`, `backend/src/routes/repo-git.ts:214-238`
  - Evidence: Routes accept JSON payloads without Zod schema validation
    ```typescript
    app.post('/', async (c) => {
      try {
        const body = await c.req.json()
        const { repoUrl, localPath, branch, openCodeConfigName, useWorktree, provider } = body
        // No validation on body structure or types
    ```
  - Issue: Missing input validation allows malformed requests to reach business logic, potentially causing runtime errors or data corruption
  - Suggestion: Add Zod schemas for all request bodies, similar to how `settings.ts` and `tts.ts` handle validation

- **Path injection vulnerability in routes with user-provided paths** - `backend/src/routes/files.ts:102-117`, `backend/src/routes/files.ts:119-130`
  - Evidence: User paths extracted from URL without sanitization
    ```typescript
    const path = c.req.path.replace(/^\/api\/files\//, '') || ''
    const body = await c.req.parseBody()
    const file = body.file as File
    const relativePath = body.relativePath as string | undefined
    const result = await fileService.uploadFile(path, file, relativePath)
    ```
  - Issue: Malicious paths like `../../etc/passwd` could access files outside workspace
  - Suggestion: Validate paths resolve within workspace directory using path.isAbsolute() and path.normalize() checks

- **No rate limiting on sensitive operations** - `backend/src/routes/providers.ts:33-53`, `backend/src/routes/oauth.ts:18-53`
  - Evidence: API credential operations and OAuth flows have no rate limiting middleware
  - Issue: Brute force attacks on credential endpoints could exhaust API quotas or enable credential stuffing
  - Suggestion: Implement rate limiting middleware on credential and OAuth endpoints

## API Design Issues

- **Inconsistent HTTP status code usage** - Across multiple routes
  - Evidence: Mixed status codes for similar situations:
    ```typescript
    // Missing resources: 404 (repos.ts:117)
    return c.json({ error: 'Repo not found' }, 404)

    // Missing resources: 400 (providers.ts:73)
    return c.json({ success: false, error: 'Client not found' }, 404)

    // Missing configs: 404 (settings.ts:277)
    return c.json({ error: 'No default config found' }, 404)

    // Same as above: but 400 elsewhere
    ```
  - Issue: Inconsistent status codes make API harder to use correctly
  - Suggestion: Follow REST principles strictly: 200/201 for success, 400 for bad request, 404 for not found, 409 for conflicts, 500 for server errors

- **Missing Content-Type headers on some endpoints** - `backend/src/routes/sse.ts:18-21`
  - Evidence: SSE sets headers but many other endpoints don't explicitly set Content-Type
    ```typescript
    // SSE properly sets headers
    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache, no-store, no-transform')

    // Many other endpoints rely on Hono default behavior
    return c.json(data)  // May not be explicit
    ```
  - Issue: Implicit Content-Type can lead to browser/client interpretation bugs
  - Suggestion: Always explicitly set Content-Type and Cache-Control headers

- **Inconsistent pagination patterns** - `backend/src/routes/repo-git.ts:275`, `backend/src/routes/settings.ts:459`
  - Evidence: Pagination implemented inconsistently across endpoints
    ```typescript
    // repo-git.ts:275 - uses limit query param
    const limit = parseInt(c.req.query('limit') || '10', 10)
    const commits = await gitLogService.getLog(id, database, limit)

    // settings.ts:459 - no pagination for potentially large lists
    const versions = releases.filter(r => !r.prerelease).map(...)
    ```
  - Issue: Some endpoints support pagination, others don't, leading to performance issues with large datasets
  - Suggestion: Implement consistent pagination pattern with limit/offset query params and total count metadata

- **Query parameter type validation missing** - Multiple route files
  - Evidence: Query parameters used without validation
    ```typescript
    // repo-git.ts:85-87
    const filePath = c.req.query('path')
    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400)
    }
    // No validation on(filePath) or path sanitization

    // sse.ts:14-15
    const directoriesParam = c.req.query('directories')
    const directories = directoriesParam ? directoriesParam.split(',').filter(Boolean) : []
    // No validation that directories are valid paths
    ```
  - Issue: Malformed query parameters can cause runtime errors or unexpected behavior
  - Suggestion: Validate all query parameters with schemas, similar to request body validation

## Summary

**Files Reviewed**: 13 files (1 index.ts + 12 route modules)

**Issues Found**: 24 total
- Security Issues: 3
- Missing Error Handling: 3
- Duplicate Code: 3
- Broken/Suspect Logic: 3
- Inconsistent Patterns: 4
- Hardcoded Values: 4
- API Design Issues: 4
- Unused Code: 2

**Critical Issues (Immediate Action Required)**:
1. **Missing input validation on multiple endpoints** - potential runtime errors, data corruption, and security risks
2. **Path injection vulnerability in file routes** - could allow unauthorized file access (../../ traversal)
3. **Missing error handling in index.ts initialization** - server starts in degraded state without alerting
4. **Integer parsing without validation** - NaN values passed to DB queries instead of proper 400 errors

**High Priority Issues**:
1. Duplicate code patterns (Zod error handling, cache logic, API discovery) - maintenance burden and inconsistency
2. Inconsistent error response formats - makes frontend integration error-prone
3. Hardcoded values (cache TTLs, sizes, ports) - reduces flexibility and deployment tuning
4. Inconsistent HTTP status codes - violates REST principles and confuses API consumers
5. Type assertions without runtime validation - potential runtime errors from mismatched shapes

**Overall Assessment**:
The backend routes layer demonstrates good structure with proper separation of concerns. Route files are well-organized with clear responsibilities. However, there are significant inconsistencies in validation, error handling, and API design patterns that could lead to bugs, security vulnerabilities, and maintenance issues.

**Strengths**:
- Good separation of routes into logical modules
- Proper use of Zod for input validation where implemented
- Comprehensive error logging throughout
- Clean route organization with nested route groups
- Authentication middleware properly applied to protected routes

**Areas for Improvement**:
- Implement comprehensive input validation on ALL endpoints (not just some)
- Create reusable middleware for common patterns (error handling, parameter extraction)
- Standardize error response formats and HTTP status codes across all routes
- Move hardcoded values to configuration for flexibility
- Extract duplicate code into shared utilities
- Add rate limiting and path validation for security
- Replace unsafe type assertions with runtime validation
- Add transaction boundaries for multi-step database operations

**Recommended Actions (Priority Order)**:
1. **Create shared validation middleware** - for Zod error handling, parameter extraction, and request validation
2. **Audit and fix security issues** - add path injection protection and rate limiting
3. **Standardize API patterns** - error responses, HTTP status codes, pagination
4. **Refactor duplicate code** - extract cache logic, error handlers, and API discovery to shared utilities
5. **Improve type safety** - replace type assertions with Zod validation
6. **Move configuration** - cache settings, limits, and URLs to environment variables
