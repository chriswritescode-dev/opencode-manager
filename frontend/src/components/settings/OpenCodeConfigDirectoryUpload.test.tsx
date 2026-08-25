import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FILE_LIMITS } from '@/config'
import { OpenCodeConfigDirectoryUpload } from './OpenCodeConfigDirectoryUpload'
import type { DirectoryUploadItem } from '@/lib/directoryUpload'
import type { ReplaceOpenCodeConfigDirectoryResult } from '@opencode-manager/shared/types'

const {
  mockReplaceOpenCodeConfigDirectory,
  mockGetOpenCodeImportStatus,
  mockGetUploadItemsFromDataTransfer,
  mockGetUploadItemsFromFileList,
  mockShowToast,
} = vi.hoisted(() => ({
  mockReplaceOpenCodeConfigDirectory: vi.fn(),
  mockGetOpenCodeImportStatus: vi.fn(),
  mockGetUploadItemsFromDataTransfer: vi.fn(),
  mockGetUploadItemsFromFileList: vi.fn(),
  mockShowToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    replaceOpenCodeConfigDirectory: mockReplaceOpenCodeConfigDirectory,
    getOpenCodeImportStatus: mockGetOpenCodeImportStatus,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: mockShowToast,
}))

vi.mock('@/lib/directoryUpload', () => ({
  DIRECTORY_INPUT_PROPS: { webkitdirectory: '', directory: '' },
  getUploadItemsFromDataTransfer: mockGetUploadItemsFromDataTransfer,
  getUploadItemsFromFileList: mockGetUploadItemsFromFileList,
  openPicker: vi.fn(),
  readUploadItemsFromInput: () => mockGetUploadItemsFromFileList(),
  useDirectoryDropZone: (options: {
    shouldSkip?: (relativePath: string, isDirectory: boolean) => boolean
    onItems: (items: DirectoryUploadItem[]) => void | Promise<void>
  }) => ({
    dropZoneRef: { current: null },
    isDragging: false,
    dropHandlers: {
      onDragEnter: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: async (e: React.DragEvent) => {
        const items = await mockGetUploadItemsFromDataTransfer(e.dataTransfer)
        await options.onItems(items)
      },
    },
  }),
}))

const IMPORT_STATUS = { workspaceConfigDirectory: '/workspace/.config/opencode' }

const RESULT: ReplaceOpenCodeConfigDirectoryResult = {
  configSourceFilename: 'opencode.jsonc',
  filesInstalled: ['opencode.json', 'skills/x/SKILL.md', 'plugin/p.js'],
  skippedPaths: ['node_modules/pkg/index.js'],
  preservedEntries: ['node_modules'],
  executablesRestored: ['scripts/run.sh'],
}

function makeItem(relativePath: string, size = 10): DirectoryUploadItem {
  const name = relativePath.split('/').pop() ?? 'file'
  return { file: new File([new Uint8Array(size)], name), relativePath }
}

function renderComponent(props?: { onReplaced?: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenCodeConfigDirectoryUpload {...props} />
    </QueryClientProvider>,
  )
}

async function dropItems(items: DirectoryUploadItem[]) {
  mockGetUploadItemsFromDataTransfer.mockResolvedValue(items)
  fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })
  await screen.findByText('Replace OpenCode Config Directory?')
}

describe('OpenCodeConfigDirectoryUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeImportStatus.mockResolvedValue(IMPORT_STATUS)
    mockReplaceOpenCodeConfigDirectory.mockResolvedValue(RESULT)
  })

  it('stages a dropped folder and replaces only after destructive confirmation', async () => {
    const user = userEvent.setup()
    const items = [
      makeItem('opencode/opencode.jsonc'),
      makeItem('opencode/skills/x/SKILL.md'),
      makeItem('opencode/plugin/p.js'),
    ]
    renderComponent()

    await dropItems(items)

    expect(screen.getByText('/workspace/.config/opencode')).toBeInTheDocument()
    expect(screen.getByText('3 files (30 Bytes)')).toBeInTheDocument()
    expect(screen.getByText('opencode.jsonc')).toBeInTheDocument()
    expect(screen.getByText('plugin')).toBeInTheDocument()
    expect(screen.getByText('skills')).toBeInTheDocument()
    expect(
      screen.getByText('Every file currently in the destination directory except node_modules will be deleted.'),
    ).toBeInTheDocument()

    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Replace and Restart' }))

    await waitFor(() => expect(mockReplaceOpenCodeConfigDirectory).toHaveBeenCalledTimes(1))
    expect(mockReplaceOpenCodeConfigDirectory).toHaveBeenCalledWith(items)
  })

  it('cancelling the dialog performs no request and discards the staged items', async () => {
    const user = userEvent.setup()
    renderComponent()

    await dropItems([makeItem('opencode/opencode.jsonc'), makeItem('opencode/skills/x/SKILL.md')])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
  })

  it('rejects a drop without a root config file before any request', async () => {
    renderComponent()

    mockGetUploadItemsFromDataTransfer.mockResolvedValue([
      makeItem('folder/AGENTS.md'),
      makeItem('folder/skills/x/SKILL.md'),
    ])
    fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })

    await waitFor(() =>
      expect(mockShowToast.error).toHaveBeenCalledWith(
        'Uploaded directory must contain opencode.json or opencode.jsonc at its root',
      ),
    )
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()
  })

  it('rejects an empty drop with an error toast', async () => {
    renderComponent()

    mockGetUploadItemsFromDataTransfer.mockResolvedValue([])
    fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })

    await waitFor(() => expect(mockShowToast.error).toHaveBeenCalled())
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
  })

  it('rejects a staged set exceeding the file-count ceiling before any request', async () => {
    const items = [makeItem('f/opencode.jsonc')]
    for (let i = 0; i < 5000; i++) {
      items.push(makeItem(`f/file${i}.md`))
    }
    renderComponent()

    mockGetUploadItemsFromDataTransfer.mockResolvedValue(items)
    fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })

    await waitFor(() =>
      expect(mockShowToast.error).toHaveBeenCalledWith(
        'Uploaded config directory contains too many files (max 5000)',
      ),
    )
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()
  })

  it('rejects a staged set exceeding the upload-size ceiling before any request', async () => {
    const oversized = new File([], 'big.bin')
    Object.defineProperty(oversized, 'size', { value: FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES + 1 })
    renderComponent()

    mockGetUploadItemsFromDataTransfer.mockResolvedValue([
      makeItem('f/opencode.json', 0),
      { file: oversized, relativePath: 'f/big.bin' },
    ])
    fireEvent.drop(screen.getByTestId('config-directory-drop-zone'), { dataTransfer: { items: [] } })

    await waitFor(() =>
      expect(mockShowToast.error).toHaveBeenCalledWith('Uploaded config directory files exceed maximum upload size'),
    )
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()
  })

  it('collects through the folder picker, applies the exclusion filter, and opens the confirmation', async () => {
    const user = userEvent.setup()
    const { container } = renderComponent()

    mockGetUploadItemsFromFileList.mockReturnValue([
      makeItem('opencode/opencode.jsonc'),
      makeItem('opencode/node_modules/pkg/index.js'),
      makeItem('opencode/skills/x/SKILL.md'),
    ])

    await user.click(screen.getByRole('button', { name: 'Choose Folder' }))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [] } })

    await screen.findByText('Replace OpenCode Config Directory?')
    expect(screen.getByText('2 files (20 Bytes)')).toBeInTheDocument()
    expect(screen.getByText('opencode.jsonc')).toBeInTheDocument()
    expect(screen.getByText('skills')).toBeInTheDocument()
    expect(screen.queryByText('node_modules')).not.toBeInTheDocument()
    expect(mockReplaceOpenCodeConfigDirectory).not.toHaveBeenCalled()
  })

  it('shows the result panel after a successful replace', async () => {
    const user = userEvent.setup()
    mockReplaceOpenCodeConfigDirectory.mockResolvedValue(RESULT)
    renderComponent()

    await dropItems([makeItem('opencode/opencode.jsonc')])

    await user.click(screen.getByRole('button', { name: 'Replace and Restart' }))

    expect(await screen.findByText('Replace complete')).toBeInTheDocument()
    expect(screen.getByText('3 files installed, 1 skipped')).toBeInTheDocument()
    expect(screen.getByText('Preserved: node_modules')).toBeInTheDocument()
    expect(screen.getByText('Executables restored: 1')).toBeInTheDocument()
    expect(
      screen.getByText('The uploaded opencode.jsonc was installed as opencode.json.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(mockShowToast.success).toHaveBeenCalled())
    expect(screen.queryByText('Replace OpenCode Config Directory?')).not.toBeInTheDocument()
  })

  it('invokes onReplaced after a successful replace so the parent refetches configs', async () => {
    const user = userEvent.setup()
    const onReplaced = vi.fn()
    renderComponent({ onReplaced })

    await dropItems([makeItem('opencode/opencode.jsonc')])

    await user.click(screen.getByRole('button', { name: 'Replace and Restart' }))

    await waitFor(() => expect(onReplaced).toHaveBeenCalledTimes(1))
  })

  it('surfaces a failed replace through an error toast', async () => {
    const user = userEvent.setup()
    mockReplaceOpenCodeConfigDirectory.mockRejectedValue(new Error('boom'))
    renderComponent()

    await dropItems([makeItem('opencode/opencode.jsonc')])

    await user.click(screen.getByRole('button', { name: 'Replace and Restart' }))

    await waitFor(() =>
      expect(mockShowToast.error).toHaveBeenCalledWith('Failed to replace the OpenCode config directory'),
    )
  })
})
