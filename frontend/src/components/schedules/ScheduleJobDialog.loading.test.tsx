import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { renderScheduleJobDialog } from '@/test/scheduleJobDialog'

describe('ScheduleJobDialog — templates loading', () => {
  it('renders without an infinite render loop while templates are loading', async () => {
    await renderScheduleJobDialog({
      templatesPending: true,
      showRepoSelector: true,
      repoId: ASSISTANT_REPO_ID,
    })

    await waitFor(() => expect(screen.getByText('New schedule')).toBeInTheDocument())
  })
})
