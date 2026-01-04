# Plan: Refactor iOS Safe Area (TDD)

**Repo:** `~/s/opencode-manager`
**Branch:** `fix/ios-safe-area-insets`
**Server:** `opencode.barracuda-emperor.ts.net` (currently running this fork)

---

## Current State

- `pt-safe` CSS utility exists
- `FullscreenSheet` component exists
- `DialogContent` has `fullscreen` prop
- Page headers still use manual `pt-safe` scattered across components

## Goal

Single fix point for each pattern:
- **Page headers** -> `PageHeader` component
- **Fullscreen overlays** -> `FullscreenSheet` component (done)
- **Fullscreen dialogs** -> `DialogContent fullscreen` prop (done)

---

## Approach: Test-Driven Development

1. Write failing tests
2. Implement to pass
3. Refactor

---

## Tasks

### Phase 1: Setup & Discovery

1. **Check existing test setup**
   - Find test framework (Vitest? Jest?)
   - Locate existing component tests
   - Understand test patterns used

2. **Identify testable requirements**
   - `PageHeader` renders with `pt-safe` class
   - `PageHeader` renders with `sticky top-0`
   - `Header` uses `PageHeader` internally
   - `SessionDetailHeader` uses `PageHeader` internally
   - Safe area CSS utility exists

---

### Phase 2: Write Failing Tests

3. **Test: `pt-safe` CSS utility**
   ```ts
   // Verify .pt-safe class exists in compiled CSS
   // Or: snapshot test index.css contains pt-safe
   ```

4. **Test: `PageHeader` component**
   ```ts
   describe('PageHeader', () => {
     it('applies pt-safe class for iOS safe area')
     it('applies sticky top-0 positioning')
     it('renders children correctly')
     it('merges custom className')
   })
   ```

5. **Test: `Header` uses `PageHeader`**
   ```ts
   describe('Header', () => {
     it('renders PageHeader as root element')
     it('inherits safe area padding from PageHeader')
   })
   ```

6. **Test: `SessionDetailHeader` uses `PageHeader`**
   ```ts
   describe('SessionDetailHeader', () => {
     it('renders PageHeader as root element')
     it('loading state uses PageHeader')
   })
   ```

---

### Phase 3: Implement to Pass

7. **Create `PageHeader` component** -> pass PageHeader tests

8. **Refactor `Header.tsx`** -> pass Header tests

9. **Refactor `SessionDetailHeader.tsx`** -> pass SessionDetailHeader tests

---

### Phase 4: Integration Testing

10. **Manual iOS testing**
    - Main repos page
    - Repo detail page
    - Session detail page
    - Settings dialog
    - File browser sheet
    - File preview modal

---

### Phase 5: Finalize

11. **Commit with passing tests**

12. **Create upstream PR** to `chriswritescode-dev/opencode-manager`

---

## Files to Modify

```
frontend/src/components/ui/page-header.tsx           # CREATE
frontend/src/components/ui/page-header.test.tsx      # CREATE
frontend/src/components/layout/Header.tsx            # MODIFY
frontend/src/components/layout/Header.test.tsx       # CREATE/MODIFY
frontend/src/components/session/SessionDetailHeader.tsx      # MODIFY
frontend/src/components/session/SessionDetailHeader.test.tsx # CREATE/MODIFY
```

---

## Commands to Resume

```bash
cd ~/s/opencode-manager
git status
git log --oneline -5

# Find test setup
find . -name "*.test.*" -o -name "*.spec.*" | head -20
cat package.json | jq '.scripts'
cat vitest.config.* 2>/dev/null || cat jest.config.* 2>/dev/null

# Run existing tests
pnpm test
```

---

## Server Deployment (for manual testing)

```bash
# After changes, push to fork
git add -A && git commit -m "message" && git push

# Update server
sshpass -p 'opencode123' ssh root@opencode.barracuda-emperor.ts.net \
  'cd /root/opencode-manager && git fetch fork && git checkout fork/fix/ios-safe-area-insets && docker compose build && docker compose up -d'

# Restore oh-my-opencode configs after rebuild
# (configs reset on container recreate - see previous session for commands)
```
