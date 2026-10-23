import { create } from 'zustand'
import type { FileAttachmentInfo, ImageAttachment } from '@/api/types'

export interface ComposerDraft {
  prompt: string
  isBashMode: boolean
  attachedFiles: Map<string, FileAttachmentInfo>
  imageAttachments: ImageAttachment[]
}

export interface ComposerDraftClearOptions {
  keepAttachments?: boolean
}

interface ComposerDraftStore {
  drafts: Record<string, ComposerDraft>
  getDraft: (sessionID: string) => ComposerDraft
  saveDraft: (sessionID: string, draft: ComposerDraft) => void
  clearDraft: (sessionID: string) => void
  clearDraftIfUnchanged: (sessionID: string, submitted: ComposerDraft, options?: ComposerDraftClearOptions) => void
}

const matchesSubmittedDraft = (draft: ComposerDraft, submitted: ComposerDraft): boolean =>
  draft.prompt === submitted.prompt &&
  draft.attachedFiles === submitted.attachedFiles &&
  draft.imageAttachments === submitted.imageAttachments

const createEmptyDraft = (): ComposerDraft => ({
  prompt: '',
  isBashMode: false,
  attachedFiles: new Map(),
  imageAttachments: [],
})

export const useComposerDraftStore = create<ComposerDraftStore>((set, get) => ({
  drafts: {},
  getDraft: (sessionID) => get().drafts[sessionID] ?? createEmptyDraft(),
  saveDraft: (sessionID, draft) => {
    set((state) => ({ drafts: { ...state.drafts, [sessionID]: draft } }))
  },
  clearDraft: (sessionID) => {
    set((state) => {
      if (!(sessionID in state.drafts)) return state
      const drafts = { ...state.drafts }
      delete drafts[sessionID]
      return { drafts }
    })
  },
  clearDraftIfUnchanged: (sessionID, submitted, options) => {
    set((state) => {
      const draft = state.drafts[sessionID]
      if (!draft || !matchesSubmittedDraft(draft, submitted)) return state
      if (options?.keepAttachments && (submitted.attachedFiles.size > 0 || submitted.imageAttachments.length > 0)) {
        return {
          drafts: {
            ...state.drafts,
            [sessionID]: {
              prompt: '',
              isBashMode: false,
              attachedFiles: submitted.attachedFiles,
              imageAttachments: submitted.imageAttachments,
            },
          },
        }
      }
      const drafts = { ...state.drafts }
      delete drafts[sessionID]
      return { drafts }
    })
  },
}))
