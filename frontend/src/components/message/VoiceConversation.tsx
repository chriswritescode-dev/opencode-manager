import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { useSessionTranscriptSnapshot } from '@/contexts/session-transcript-context'
import { useVoiceConversation, type UseVoiceConversationInput } from '@/hooks/useVoiceConversation'
import { useVoicePauseSetting } from '@/hooks/useVoicePauseSetting'
import { VoiceConversationBar } from './VoiceConversationBar'

/** Controls the voice conversation that lives inside the session composer. */
export interface VoiceConversationHandle {
  /** Starts the conversation loop. */
  start: () => void
}

export interface VoiceConversationProps {
  /** Id of the session the conversation belongs to. */
  sessionID: string
  /** Server that owns the session, when it is not the local one. */
  serverId?: string
  /** Whether the session is waiting for the user to approve a tool or a form. */
  hasPendingApproval: boolean
  /** Sends one transcribed turn to the session. */
  sendTurn: UseVoiceConversationInput['sendTurn']
  /** Aborts the reply that the session is currently producing. */
  interrupt: UseVoiceConversationInput['interrupt']
  /** Hands a captured transcript to the composer for editing. */
  onEditInTextBox: UseVoiceConversationInput['onEditInTextBox']
  /** Opens the pending approval dialog. */
  onViewApproval: () => void
  /** Reports whether voice mode is running, including while paused. */
  onActiveChange: (active: boolean) => void
}

/**
 * Owns the hands-free voice conversation for a session and renders its bar in
 * place of the composer while the conversation runs. It reads the transcript
 * from {@link useSessionTranscriptSnapshot}, so the composer that hosts it does
 * not re-render when the transcript changes, and it stays mounted for the whole
 * session because the conversation keeps its sweep, visibility listener and
 * cleanup effects alive between turns.
 */
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
  }, ref) {
    const { messages, pending, status } = useSessionTranscriptSnapshot()
    const { pauseMs } = useVoicePauseSetting()
    const controller = useVoiceConversation({
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
