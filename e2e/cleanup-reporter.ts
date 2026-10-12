import { rm } from 'node:fs/promises'
import type { FullResult, Reporter } from '@playwright/test/reporter'
import { REPORT_DIR, TEST_RESULTS_DIR } from './env'

/** Removes the HTML report and test results after a passing run; failed runs keep them for debugging and CI upload. */
export default class CleanupPassedRunReporter implements Reporter {
  private status: FullResult['status'] | undefined

  onEnd(result: FullResult) {
    this.status = result.status
  }

  async onExit() {
    if (this.status !== 'passed') return
    await Promise.all([
      rm(REPORT_DIR, { recursive: true, force: true }),
      rm(TEST_RESULTS_DIR, { recursive: true, force: true }),
    ])
  }

  printsToStdio() {
    return false
  }
}
