import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { FileInfo } from '@/types/files'
import { FileTree } from './FileTree'

const file: FileInfo = {
  name: 'notes.txt',
  path: 'docker/notes.txt',
  isDirectory: false,
  size: 5,
  mimeType: 'text/plain',
  content: '',
  lastModified: new Date('2026-07-28T09:12:40Z'),
}

describe('FileTree row actions', () => {
  it('names the per-row actions trigger after the file', () => {
    render(
      <FileTree
        files={[file]}
        onFileSelect={vi.fn()}
        onDirectoryClick={vi.fn()}
        selectedFile={null}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Actions for notes.txt' })).toBeInTheDocument()
  })
})
