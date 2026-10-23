import { describe, it, expect, beforeEach } from 'vitest'
import { useComposerDraftStore, type ComposerDraft } from './composerDraftStore'

const createDraft = (prompt: string): ComposerDraft => ({
  prompt,
  isBashMode: false,
  attachedFiles: new Map(),
  imageAttachments: [],
})

describe('useComposerDraftStore', () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ drafts: {} })
  })

  it('clears the stored draft when it still holds the submitted content', () => {
    const submitted = createDraft('sent message')
    useComposerDraftStore.getState().saveDraft('session-1', submitted)

    useComposerDraftStore.getState().clearDraftIfUnchanged('session-1', submitted)

    expect(useComposerDraftStore.getState().drafts['session-1']).toBeUndefined()
  })

  it('keeps text typed after the submit', () => {
    const submitted = createDraft('sent message')
    useComposerDraftStore.getState().saveDraft('session-1', submitted)
    const edited = createDraft('sent message and more')
    useComposerDraftStore.getState().saveDraft('session-1', edited)

    useComposerDraftStore.getState().clearDraftIfUnchanged('session-1', submitted)

    expect(useComposerDraftStore.getState().getDraft('session-1')).toBe(edited)
  })

  it('keeps attachments replaced after the submit', () => {
    const submitted = createDraft('sent message')
    useComposerDraftStore.getState().saveDraft('session-1', submitted)
    const edited = { ...submitted, attachedFiles: new Map([['file', { path: '/tmp/file', name: 'file' }]]) }
    useComposerDraftStore.getState().saveDraft('session-1', edited)

    useComposerDraftStore.getState().clearDraftIfUnchanged('session-1', submitted)

    expect(useComposerDraftStore.getState().getDraft('session-1')).toBe(edited)
  })

  it('keeps the draft of another session', () => {
    const submitted = createDraft('sent from session 1')
    const other = createDraft('draft for session 2')
    useComposerDraftStore.getState().saveDraft('session-1', submitted)
    useComposerDraftStore.getState().saveDraft('session-2', other)

    useComposerDraftStore.getState().clearDraftIfUnchanged('session-1', submitted)

    expect(useComposerDraftStore.getState().getDraft('session-2')).toBe(other)
  })

  it('keeps the submitted attachments when asked to', () => {
    const submitted: ComposerDraft = {
      prompt: '!ls',
      isBashMode: true,
      attachedFiles: new Map([['file', { path: '/tmp/file', name: 'file' }]]),
      imageAttachments: [],
    }
    useComposerDraftStore.getState().saveDraft('session-1', submitted)

    useComposerDraftStore.getState().clearDraftIfUnchanged('session-1', submitted, { keepAttachments: true })

    const draft = useComposerDraftStore.getState().getDraft('session-1')
    expect(draft.prompt).toBe('')
    expect(draft.isBashMode).toBe(false)
    expect(draft.attachedFiles).toBe(submitted.attachedFiles)
  })
})
