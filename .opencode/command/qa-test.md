---
description: Run comprehensive QA tests and generate a report
agent: qa-tester
subtask: true
---

Run comprehensive QA tests on the OpenCode Manager application.

Test the following components:
1. Development server health (backend, OpenCode server, database)
2. Backend API endpoints (/api/health, /api/repos, /api/settings)
3. Authentication (if enabled)
4. Database integrity

Generate a test report with:
- Pass/fail status for each test
- Performance metrics (response times)
- Any issues found with recommendations
- Overall system health assessment

Target: http://localhost:5001 (development server)
