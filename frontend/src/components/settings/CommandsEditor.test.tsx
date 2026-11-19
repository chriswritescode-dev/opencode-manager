import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandsEditor } from './CommandsEditor'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const mockCommands = {
  'review': {
    template: 'Review this code',
    description: 'Reviews code changes',
    agent: 'code-reviewer',
  },
  'build': {
    template: 'Build the project',
    description: 'Builds the project',
  },
}

function renderEditor(ui: Parameters<typeof renderWithProviders>[0], fetchRoutes: FetchRoute[] = []) {
  return renderWithProviders(ui, { auth: false, theme: false, tts: false, fetchRoutes })
}

function selectFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found')
  fireEvent.change(input, { target: { files } })
}

function makeFile(name: string, relativePath: string, content = 'body') {
  const file = new File([content], name, { type: 'text/markdown' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

const installRoute: FetchRoute = {
  method: 'POST',
  path: '/api/settings/opencode-directory-files/install',
  respond: () => ({ json: { kind: 'commands', filesInstalled: ['git/commit.md'] } }),
}

describe('CommandsEditor', () => {
  it('renders empty state when no commands configured', () => {
    renderEditor(<CommandsEditor commands={{}} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('No commands configured')).toBeInTheDocument()
    expect(screen.getByText('Add your first command to get started.')).toBeInTheDocument()
  })

  it('renders command names without a leading slash', () => {
    renderEditor(<CommandsEditor commands={mockCommands} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('build')).toBeInTheDocument()
    expect(screen.queryByText('/review')).not.toBeInTheDocument()
  })

  it('renders uploaded directory command files', () => {
    renderEditor(
      <CommandsEditor
        commands={{}}
        directoryCommands={[{ kind: 'commands', name: 'deploy', relativePath: 'project/deploy.md' }]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('deploy')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: project/deploy.md')).toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.queryByText('No commands configured')).not.toBeInTheDocument()
  })

  it('opens the edit dialog from the row action', async () => {
    const user = userEvent.setup()
    renderEditor(<CommandsEditor commands={mockCommands} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getAllByText('Edit')[0])

    expect(await screen.findByRole('dialog', { name: 'Edit Command' })).toBeInTheDocument()
  })

  it('opens the edit dialog from the row body', async () => {
    const user = userEvent.setup()
    renderEditor(<CommandsEditor commands={mockCommands} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getByText('review'))

    expect(await screen.findByRole('dialog', { name: 'Edit Command' })).toBeInTheDocument()
  })

  it('opens the create dialog from the add button', async () => {
    const user = userEvent.setup()
    renderEditor(<CommandsEditor commands={{}} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getByText('Add Command'))

    expect(await screen.findByRole('dialog', { name: 'Create Command' })).toBeInTheDocument()
  })

  it('calls onDelete with the command name when Delete is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderEditor(<CommandsEditor commands={mockCommands} onSave={vi.fn()} onDelete={onDelete} />)

    await user.click(screen.getByLabelText('Actions for review'))
    await user.click(screen.getByText('Delete'))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('review')
  })

  it('renders agent badge when command has agent', () => {
    renderEditor(<CommandsEditor commands={mockCommands} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
  })

  it('uploads only markdown files from a selected commands folder', async () => {
    const markdownFile = makeFile('commit.md', 'commands/git/commit.md', 'commit body')
    const systemFile = makeFile('.DS_Store', 'commands/.DS_Store', 'metadata')
    const { container, fetchFake } = renderEditor(
      <CommandsEditor commands={{}} onSave={vi.fn()} onDelete={vi.fn()} />,
      [installRoute],
    )

    selectFiles(container, [markdownFile, systemFile])

    expect(await screen.findByText('Uploaded 1 command file')).toBeInTheDocument()
    const formData = fetchFake.findFormData()
    expect(formData?.get('fileManifest')).toBe(
      JSON.stringify([{ fieldName: 'file0', relativePath: 'commands/git/commit.md' }]),
    )
    expect(formData?.getAll('file0')).toHaveLength(1)
  })

  it('shows an error when a selected commands folder has no markdown files', async () => {
    const systemFile = makeFile('.DS_Store', 'commands/.DS_Store', 'metadata')
    const { container, fetchFake } = renderEditor(
      <CommandsEditor commands={{}} onSave={vi.fn()} onDelete={vi.fn()} />,
      [installRoute],
    )

    selectFiles(container, [systemFile])

    expect(await screen.findByText('No markdown commands files found')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/settings/opencode-directory-files/install')).toHaveLength(0)
  })
})
