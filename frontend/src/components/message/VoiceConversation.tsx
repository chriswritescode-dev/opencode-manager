import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { useSessionTranscriptSnapshot } from '@/contexts/session-transcript-context'
import { useVoiceConversation, type UseVoiceConversationInput, type VoiceConversationController } from '@/hooks/useVoiceConversation'
import { useVoicePauseSetting } from '@/hooks/useVoicePauseSetting'
import { VoiceConversationBar } from './VoiceConversationBar'

export interface VoiceConversationHandle {
  start: () => void
}

export type VoiceConversationFactory = (input: UseVoiceConversationInput) => VoiceConversationController

export interface VoiceConversationProps {
  sessionID: string
  serverId?: string
  hasPendingApproval: boolean
  sendTurn: UseVoiceConversationInput['sendTurn']
  interrupt: UseVoiceConversationInput['interrupt']
  onEditInTextBox: UseVoiceConversationInput['onEditInTextBox']
  onViewApproval: () => void
  onActiveChange: (active: boolean) => void
  voiceConversation?: VoiceConversationFactory
}

export const VoiceConversation = forwardRef<VoiceConversationHandle, VoiceConversationProps>(
  function VoiceConversation({
    sessionID,
    serverId,
    hasPendingApproval,
    sendTurn,
    interrupt,
    onEditInTextBox,
    onViewApproval,
    onActiveChange,
    voiceConversation = useVoiceConversation,
  }, ref) {
    const { messages, pending, status } = useSessionTranscriptSnapshot()
    const { pauseMs } = useVoicePauseSetting()
    const controller = voiceConversation({
      sessionID,
      serverId,
      messages,
      pending,
      status,
      hasPendingApproval,
      pauseMs,
      sendTurn,
      interrupt,
      onEditInTextBox,
    })

    useImperativeHandle(ref, () => ({ start: controller.start }), [controller.start])

    useEffect(() => {
      onActiveChange(controller.isActive)
    }, [onActiveChange, controller.isActive])

    return controller.isActive ? (
      <VoiceConversationBar
        controller={controller}
        hasPendingApproval={hasPendingApproval}
        onViewApproval={onViewApproval}
      />
    ) : null
  },
)
