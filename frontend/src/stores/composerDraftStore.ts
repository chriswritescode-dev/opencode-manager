import { create } from 'zustand'
import type { FileAttachmentInfo, ImageAttachment } from '@/api/types'

export interface ComposerDraft {
  prompt: string
  isBashMode: boolean
  attachedFiles: Map<string, FileAttachmentInfo>
  imageAttachments: ImageAttachment[]
}

interface ComposerDraftStore {
  drafts: Record<string, ComposerDraft>
  getDraft: (sessionID: string) => ComposerDraft
  saveDraft: (sessionID: string, draft: ComposerDraft) => void
  clearDraft: (sessionID: string) => void
}

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
}))
