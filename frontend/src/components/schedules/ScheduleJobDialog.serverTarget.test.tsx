import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderScheduleJobDialog, makeScheduleJobFixture } from '@/test/scheduleJobDialog'

const serverTarget = { serverId: 'srv_kitchen', directory: '/srv/projects/audit' }

describe('ScheduleJobDialog — server target', () => {
  it('hides worktree workspace mode and submits an in-place target directory', async () => {
    const dialog = await renderScheduleJobDialog({
      job: makeScheduleJobFixture({
        id: 7,
        repoId: null,
        serverId: 'srv_kitchen',
        directory: '/srv/projects/audit',
        name: 'Nightly audit',
        prompt: 'Audit the project.',
        workspaceMode: 'in-place',
      }),
      serverTarget,
    })

    await waitFor(() => expect(screen.getByText('Edit schedule')).toBeInTheDocument())

    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Base branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Fresh worktree, cleaned up')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(dialog.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        workspaceMode: 'in-place',
        directory: '/srv/projects/audit',
        branch: null,
      })),
    )
  })
})
