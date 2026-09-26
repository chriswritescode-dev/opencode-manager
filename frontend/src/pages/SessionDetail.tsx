import { useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { FloatingTTSButton } from '@/components/message/FloatingTTSButton'
import { X, CornerUpLeft } from "lucide-react";
import { Header } from "@/components/ui/header";
import { SessionList } from "@/components/session/SessionList";
import { getSessionListPath } from '@/lib/navigation'
import { FetchError } from '@/api/fetchWrapper'

import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { useSession, useInterruptSession, useUpdateSession, useCreateSession } from "@/hooks/useOpenCode";
import { useSessionTranscript } from "@/hooks/useSessionTranscript";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useSSE } from "@/hooks/useSSE";
import { useUIState } from "@/stores/uiStateStore";
import { useSettings } from "@/hooks/useSettings";
import { useModelSelection } from "@/hooks/useModelSelection";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useMobile } from "@/hooks/useMobile";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useTTS } from "@/hooks/useTTS";
import { getAssistantText, getLatestPlayableAssistantMessage, useAutoPlayLastResponse } from "@/hooks/useAutoPlayLastResponse";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { MessageSkeleton } from "@/components/message/MessageSkeleton";
import { exportSession, downloadMarkdown } from "@/lib/exportSession";
import { getMessagesContentVersion } from "./sessionContentVersion";
import { showToast } from "@/lib/toast";
import { getRepoDisplayName } from "@/lib/utils";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { compactSession, forkSession, listSessionMessages } from "@/api/opencode";
import { useRedoMessage, useUndoMessage } from "@/hooks/useUndoMessage";
import { usePermissions, useForms } from "@/contexts/EventContext";
import type { FormInfo, SessionMessageInfo } from "@opencode-manager/shared/opencode";
import { FormPrompt } from "@/components/session/FormPrompt";
import { MinimizedFormIndicator } from "@/components/session/MinimizedFormIndicator";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { SourceControlPanel } from "@/components/source-control";
import { SessionSendErrorBanner } from "@/components/session/SessionSendErrorBanner";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { SessionMoreButton } from "@/components/navigation/SessionMoreButton";

const OLDER_HISTORY_SCROLL_THRESHOLD_PX = 200

const PENDING_ACTION_SYNC_INTERVAL_MS = 30000
const PROMPT_OVERLAY_CLEARANCE_PX = 16

function applyRevertBoundary(
  messages: SessionMessageInfo[],
  revertMessageID: string | undefined,
): SessionMessageInfo[] {
  if (!revertMessageID) return messages
  const revertIndex = messages.findIndex((message) => message.id === revertMessageID)
  if (revertIndex < 0) return messages
  return messages.slice(0, revertIndex)
}

async function fetchCompleteSessionHistory(sessionID: string): Promise<SessionMessageInfo[]> {
  let history: SessionMessageInfo[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (;;) {
    const page = await listSessionMessages(sessionID, cursor === undefined ? {} : { cursor })
    const older = page.messages.filter((message) => !seenIds.has(message.id))
    for (const message of older) seenIds.add(message.id)
    history = [...older, ...history]

    if (!page.nextCursor || seenCursors.has(page.nextCursor)) return history
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
}

function SessionRouteFallback({ message, backTo, backLabel }: { message: string; backTo: string; backLabel: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-muted-foreground">{message}</span>
        <Button variant="outline" size="sm" onClick={() => navigate(backTo)}>{backLabel}</Button>
      </div>
    </div>
  );
}

export function SessionDetail() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const repoId = Number(id) || 0;
  const isAssistantSession = new URLSearchParams(location.search).get('assistant') === '1';
  const { preferences, updateSettings } = useSettings();
  const { open: openSettings } = useSettingsDialog();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  const [minimizedFormId, setMinimizedFormId] = useState<string | null>(null);

  const isMobile = useMobile();
  const { keyboardHeight } = useVisualViewport();
  const inputBottomOffset = isMobile ? keyboardHeight : 0;
  const promptOverlayObserverRef = useRef<ResizeObserver | null>(null);
  const [promptOverlayHeight, setPromptOverlayHeight] = useState(112);

  const promptOverlayRef = useCallback((el: HTMLDivElement | null) => {
    promptOverlayObserverRef.current?.disconnect();
    promptOverlayObserverRef.current = null;
    if (!el) {
      setPromptOverlayHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPromptOverlayHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    promptOverlayObserverRef.current = observer;
  }, []);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: id !== undefined,
    retry: (failureCount, error) => !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
  });

  useRepoActivity(repoId, Boolean(repo));

  const sessionRouteSuffix = isAssistantSession ? '?assistant=1' : '';

  const repoDirectory = repo?.fullPath;
  const [resolvedSessionDirectory, setResolvedSessionDirectory] = useState<{ sessionId: string; directory: string } | null>(null);
  const sessionDirectory = (
    resolvedSessionDirectory && resolvedSessionDirectory.sessionId === sessionId
      ? resolvedSessionDirectory.directory
      : undefined
  ) ?? repoDirectory;

  const { data: session, isLoading: sessionLoading, error: sessionQueryError } = useSession(
    sessionId,
    sessionDirectory,
  );

  useEffect(() => {
    const directory = session?.location.directory;
    if (!sessionId || !directory) return;
    setResolvedSessionDirectory((current) => (
      current?.sessionId === sessionId && current.directory === directory
        ? current
        : { sessionId, directory }
    ));
  }, [sessionId, session?.location.directory]);

  const { isConnected, isReconnecting } = useSSE(sessionDirectory, sessionId);

  const {
    messages: transcriptMessages,
    pending: pendingPrompts,
    status: transcriptStatus,
    isLoading: messagesLoading,
    fetchOlder,
    hasOlder,
  } = useSessionTranscript(sessionId ?? '', sessionDirectory ?? '');

  const messages = useMemo(
    () => applyRevertBoundary(transcriptMessages, session?.revert?.messageID),
    [transcriptMessages, session?.revert?.messageID],
  );

  const messagesContentVersion = useMemo(() => getMessagesContentVersion(messages), [messages]);

  const { scrollToBottom } = useAutoScroll({
    containerRef: messageContainerRef,
    messages,
    sessionId,
    contentVersion: messagesContentVersion,
    onScrollStateChange: setShowScrollButton
  });

  const handleMessageScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!hasOlder || !fetchOlder) return
    if (event.currentTarget.scrollTop > OLDER_HISTORY_SCROLL_THRESHOLD_PX) return
    void fetchOlder().catch(() => undefined)
  }, [fetchOlder, hasOlder]);
  const interruptSession = useInterruptSession();
  const updateSession = useUpdateSession(sessionDirectory);
  const createSession = useCreateSession(sessionDirectory);
  const { modelString } = useModelSelection(sessionDirectory);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
  const setActivePromptFileBasePath = useUIState((state) => state.setActivePromptFileBasePath);
  const { isEnabled: ttsEnabled } = useTTS();
  const { syncForSession: syncPermissionsForSession } = usePermissions();
  const { getForSession: getFormForSession, reply: replyToForm, cancel: cancelForm, syncForSession: syncFormsForSession } = useForms();
  const currentForm = sessionId ? getFormForSession(sessionId) : null;
  const minimizedForm = currentForm && currentForm.id === minimizedFormId ? currentForm : null;

  const lastAssistantMessage = messages.filter(m => m.type === 'assistant').at(-1);
  const lastAssistantText = getAssistantText(lastAssistantMessage);
  const latestPlayableAssistant = useMemo(() => getLatestPlayableAssistantMessage(messages), [messages]);
  
  const isSessionActive = useMemo(() => {
    if (transcriptStatus !== 'idle') return true
    if (lastAssistantMessage && lastAssistantMessage.time.completed === undefined) return true
    return false
  }, [lastAssistantMessage, transcriptStatus])
  const hasIncompleteMessages = lastAssistantMessage ? lastAssistantMessage.time.completed === undefined : false;
  const isStreamingResponse = hasIncompleteMessages && isSessionActive;
  const workspaceBasePath = repo?.localPath;

  useEffect(() => {
    setActivePromptFileBasePath(sessionDirectory ? workspaceBasePath ?? null : null)

    return () => {
      setActivePromptFileBasePath(null)
    }
  }, [sessionDirectory, setActivePromptFileBasePath, workspaceBasePath])

  useAutoPlayLastResponse({
    sessionId: sessionId ?? '',
    lastAssistantMessage,
    lastAssistantText,
    isStreamingResponse,
  });

  const handleShowSessionsDialog = useCallback(() => setSessionsDialogOpen(true), []);
  const handleShowHelpDialog = useCallback(() => openSettings(), [openSettings]);

  const handleMinimizeForm = useCallback((form: FormInfo) => {
    setMinimizedFormId(form.id)
  }, [])

  const handleRestoreForm = useCallback(() => {
    setMinimizedFormId(null)
  }, [])

  const handleDismissMinimizedForm = useCallback(async () => {
    if (!minimizedFormId) return
    try {
      await cancelForm(minimizedFormId)
      setMinimizedFormId(null)
    } catch {
      showToast.error('Failed to dismiss form')
    }
  }, [cancelForm, minimizedFormId])

  const syncPendingActionsForSession = useCallback(async () => {
    if (!sessionDirectory || !sessionId) return
    await Promise.all([
      syncPermissionsForSession(sessionDirectory, sessionId),
      syncFormsForSession(sessionDirectory, sessionId),
    ])
  }, [sessionDirectory, sessionId, syncPermissionsForSession, syncFormsForSession])

  useQuery({
    queryKey: ['opencode', 'pending-actions', sessionId, sessionDirectory],
    queryFn: async () => {
      await syncPendingActionsForSession()
      return null
    },
    enabled: !!sessionDirectory && !!sessionId,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: !isConnected && (isSessionActive || hasIncompleteMessages) ? PENDING_ACTION_SYNC_INTERVAL_MS : false,
    retry: false,
  })

  const handleNewSession = useCallback(async () => {
    try {
      const newSession = await createSession.mutateAsync({ agent: undefined });
      if (newSession?.id) {
        navigate(`/repos/${repoId}/sessions/${newSession.id}${sessionRouteSuffix}`);
      }
    } catch {
      showToast.error('Failed to create new session');
    }
  }, [createSession, navigate, repoId, sessionRouteSuffix]);

  useSidebarAction('new-session', () => {
    handleNewSession();
  });

  const undoMessage = useUndoMessage({
    sessionId: sessionId ?? '',
    directory: sessionDirectory,
    onSuccess: (restoredPrompt) => promptInputRef.current?.setPromptValue(restoredPrompt),
  });
  const redoMessage = useRedoMessage({
    sessionId: sessionId ?? '',
    directory: sessionDirectory,
  });

  const handleCompact = useCallback(async () => {
    if (!sessionId) return;

    showToast.loading('Compacting session...', { id: `compact-${sessionId}` });

    try {
      await compactSession(sessionId);
    } catch (error) {
      showToast.error(`Compact failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sessionId]);

  const handleUndo = useCallback(async () => {
    if (!sessionId) return;
    const lastUserMessage = [...messages].reverse().find((message) => message.type === 'user');
    if (!lastUserMessage || lastUserMessage.type !== 'user') return;
    try {
      await undoMessage.mutateAsync({
        messageID: lastUserMessage.id,
        messageContent: lastUserMessage.text,
      });
    } catch {
      // The undo hook surfaces the failure.
    }
  }, [messages, sessionId, undoMessage]);

  const handleRedo = useCallback(async () => {
    if (!sessionId) return;
    try {
      await redoMessage.mutateAsync();
    } catch {
      // The redo hook surfaces the failure.
    }
  }, [sessionId, redoMessage]);

  const handleFork = useCallback(async () => {
    if (!sessionId) return;
    try {
      const forkedSession = await forkSession(sessionId);
      if (forkedSession?.id) {
        navigate(`/repos/${repoId}/sessions/${forkedSession.id}${sessionRouteSuffix}`);
        showToast.success('Session forked');
      }
    } catch (error) {
      showToast.error(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sessionId, navigate, repoId, sessionRouteSuffix]);

  const handleCloseSession = useCallback(() => {
    const tab = new URLSearchParams(location.search).get('repoTab') ?? undefined;
    navigate(getSessionListPath(repoId, isAssistantSession, tab))
  }, [navigate, repoId, isAssistantSession, location.search])

  const { leaderActive } = useKeyboardShortcuts({
    openModelDialog: () => {
      const modelSelectTrigger = document.querySelector(
        "[data-model-select-trigger]",
      ) as HTMLElement;
      modelSelectTrigger?.click();
    },
    openSessions: () => setSessionsDialogOpen(true),
    openSettings,
    newSession: handleNewSession,
    closeSession: handleCloseSession,
    compact: handleCompact,
    undo: handleUndo,
    redo: handleRedo,
    fork: handleFork,
    toggleSidebar: () => setFileBrowserOpen(!fileBrowserOpen),
    toggleMode: () => {
      const modeButton = document.querySelector(
        "[data-toggle-mode]",
      ) as HTMLButtonElement;
      modeButton?.click();
    },
    submitPrompt: () => {
      const submitButton = document.querySelector(
        "[data-submit-prompt]",
      ) as HTMLButtonElement;
      submitButton?.click();
    },
    interruptSession: () => {
      if (sessionId) {
        interruptSession.mutate(sessionId);
      }
    },
  });

  

  const handleFileClick = useCallback((filePath: string) => {
    let pathToOpen = filePath
    
    if (filePath.startsWith('/') && repo?.fullPath) {
      const workspaceReposPath = repo.fullPath.substring(0, repo.fullPath.lastIndexOf('/'))
      
      if (filePath.startsWith(workspaceReposPath + '/')) {
        pathToOpen = filePath.substring(workspaceReposPath.length + 1)
      }
    }
    
    setSelectedFilePath(pathToOpen)
    setFileBrowserOpen(true)
  }, [repo?.fullPath, setFileBrowserOpen]);

  const handleSessionTitleUpdate = useCallback((newTitle: string) => {
    if (sessionId) {
      updateSession.mutate({ sessionID: sessionId, title: newTitle });
    }
  }, [sessionId, updateSession]);

  const handleFileBrowserClose = useCallback(() => {
    setFileBrowserOpen(false)
    setSelectedFilePath(undefined)
  }, [setFileBrowserOpen]);

  const handleChildSessionClick = useCallback((childSessionId: string) => {
    navigate(`/repos/${repoId}/sessions/${childSessionId}${sessionRouteSuffix}`)
  }, [navigate, repoId, sessionRouteSuffix]);

  const handleParentSessionClick = useCallback(() => {
    if (session?.parentID) {
      navigate(`/repos/${repoId}/sessions/${session.parentID}${sessionRouteSuffix}`)
    }
  }, [navigate, repoId, session?.parentID, sessionRouteSuffix]);

  const handleToggleDetails = useCallback(() => {
    const newValue = !preferences?.expandToolCalls
    updateSettings({ expandToolCalls: newValue })
    return newValue
  }, [preferences?.expandToolCalls, updateSettings]);

  const handleExportSession = useCallback(async () => {
    if (!session || !sessionId) {
      showToast.error('No session data to export')
      return
    }

    let history: SessionMessageInfo[]
    try {
      history = await fetchCompleteSessionHistory(sessionId)
    } catch {
      showToast.error('Failed to export session')
      return
    }

    const { filename, content } = exportSession(
      applyRevertBoundary(history, session.revert?.messageID),
      session,
    )
    if (await downloadMarkdown(content, filename)) {
      showToast.success(`Exported to ${filename}`)
    }
  }, [session, sessionId]);

  const handleUndoMessage = useCallback((restoredPrompt: string) => {
    promptInputRef.current?.setPromptValue(restoredPrompt)
  }, []);

  const handleClearPrompt = useCallback(() => {
    promptInputRef.current?.clearPrompt()
  }, []);

  

  

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

  if (!isAssistantSession && repoLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <span className="text-muted-foreground">Loading repository...</span>
        </div>
      </div>
    );
  }

  if (!isAssistantSession && !repo) {
    return <SessionRouteFallback message="Repository not found" backTo="/" backLabel="Back to repositories" />;
  }

  if (sessionQueryError instanceof FetchError && sessionQueryError.statusCode === 404) {
    const listTab = new URLSearchParams(location.search).get('repoTab') ?? undefined;
    return (
      <SessionRouteFallback
        message="Session not found"
        backTo={getSessionListPath(repoId, isAssistantSession, listTab)}
        backLabel="Back to sessions"
      />
    );
  }

  const workspaceDisplayName = isAssistantSession || !repo
    ? 'Assistant'
    : getRepoDisplayName(repo);
  const tabFromUrl = new URLSearchParams(location.search).get('repoTab') ?? undefined;
  const sessionBackPath = getSessionListPath(repoId, isAssistantSession, tabFromUrl);

  return (
    <div
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
    >
      <div
        data-testid="session-header-region"
        className="flex-shrink-0 overflow-hidden bg-background max-h-72 sm:max-h-80"
      >
        <Header className="bg-background [&_button]:bg-black [&_button]:text-white [&_button]:border-zinc-700 [&_button:hover]:bg-zinc-900">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
            {session?.parentID ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleParentSessionClick}
                  className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/20 h-7 px-2 gap-1"
                  title="Back to parent session"
                >
                  <CornerUpLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Parent</span>
                </Button>
                <div className="hidden sm:block">
                  <Header.BackButton to={sessionBackPath} className="text-xs sm:text-sm" />
                </div>
              </>
            ) : (
              <Header.BackButton to={sessionBackPath} className="text-xs sm:text-sm" />
            )}
            <Header.EditableTitle
              value={session?.title || "Untitled Session"}
              onChange={handleSessionTitleUpdate}
              subtitle={<span className="text-orange-600 dark:text-orange-400">{workspaceDisplayName}</span>}
            />
          </div>
          <Header.Actions className="gap-2 sm:gap-4">
            <div className="flex items-center gap-1">
              <PendingActionsGroup />
            </div>
            <ContextUsageIndicator
              directory={sessionDirectory}
              sessionID={sessionId}
              isConnected={isConnected}
              isReconnecting={isReconnecting}
            />
            <SessionMoreButton />
          </Header.Actions>
        </Header>

      </div>

      <div className="relative flex-1 overflow-hidden flex flex-col">
        <div key={sessionId} data-testid="session-message-scroll" ref={messageContainerRef} onScroll={handleMessageScroll} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]" style={{ paddingBottom: promptOverlayHeight + inputBottomOffset + PROMPT_OVERLAY_CLEARANCE_PX }}>
          {repoLoading || sessionLoading || messagesLoading ? (
            <MessageSkeleton />
          ) : sessionDirectory ? (
            <MessageThread 
              sessionID={sessionId} 
              directory={sessionDirectory}
              messages={messages}
              pending={pendingPrompts}
              isSessionBusy={isSessionActive}
              onFileClick={handleFileClick}
              onChildSessionClick={handleChildSessionClick}
              onUndoMessage={handleUndoMessage}
              model={modelString || undefined}
            />
          ) : null}
        </div>
        {sessionDirectory && !isEditingMessage && (
          <div
            ref={promptOverlayRef}
            className="absolute left-0 right-0 flex justify-center"
            style={{ bottom: inputBottomOffset }}
          >
            <div className="relative w-[94%] md:max-w-4xl">
              <div className="absolute -top-9 right-0 z-50 flex flex-col items-end gap-2">
                {ttsEnabled && !hasPromptContent && !isSessionActive && latestPlayableAssistant && (
                  <FloatingTTSButton
                    messageId={latestPlayableAssistant.messageId}
                    content={latestPlayableAssistant.text}
                  />
                )}
                {hasPromptContent && !isSessionActive && (
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchEnd={(e) => {
                      e.preventDefault()
                      handleClearPrompt()
                    }}
                    onClick={handleClearPrompt}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border border-red-500/60 hover:border-red-400 shadow-md shadow-red-500/30 hover:shadow-red-500/50 backdrop-blur-md transition-all duration-200 active:scale-95 hover:scale-105 ring-1 ring-red-500/20 hover:ring-red-500/40"
                    aria-label="Clear"
                  >
                    <X className="w-5 h-5" />
                    <span className="text-sm font-medium hidden sm:inline">Clear</span>
                  </button>
                )}
              </div>
              {leaderActive && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-primary/90 text-primary-foreground border border-primary shadow-lg backdrop-blur-md animate-pulse">
                  <span className="text-sm font-medium">Waiting for shortcut key...</span>
                </div>
              )}
              {minimizedForm && (
                <MinimizedFormIndicator
                  form={minimizedForm}
                  onRestore={handleRestoreForm}
                  onDismiss={handleDismissMinimizedForm}
                />
              )}
              {currentForm && !minimizedForm && (
                <FormPrompt
                  key={currentForm.id}
                  form={currentForm}
                  onReply={replyToForm}
                  onCancel={cancelForm}
                  onMinimize={() => handleMinimizeForm(currentForm)}
                />
              )}
              <SessionSendErrorBanner sessionId={sessionId} isConnected={isConnected} isReconnecting={isReconnecting} />
              <PromptInput
                ref={promptInputRef}
                directory={sessionDirectory}
                sessionID={sessionId}
                showScrollButton={showScrollButton && !hasPromptContent}
                isSessionActive={isSessionActive}
                isStreamingResponse={isStreamingResponse}
                onScrollToBottom={scrollToBottom}
                onShowSessionsDialog={handleShowSessionsDialog}
                onShowHelpDialog={handleShowHelpDialog}
                onToggleDetails={handleToggleDetails}
                onExportSession={handleExportSession}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onPromptChange={setHasPromptContent}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sessions Dialog */}
      <Dialog open={sessionsDialogOpen} onOpenChange={setSessionsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogTitle>Sessions</DialogTitle>
          <div className="overflow-y-auto max-h-[60vh] mt-4">
            {sessionDirectory && (
              <SessionList
                directory={repoDirectory}
                activeSessionID={sessionId || undefined}
                onSelectSession={(sessionID) => {
                  navigate(`/repos/${repoId}/sessions/${sessionID}${sessionRouteSuffix}`)
                  setSessionsDialogOpen(false)
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={handleFileBrowserClose}
        basePath={workspaceBasePath}
        repoName={workspaceDisplayName}
        repoId={repoId}
        initialSelectedFile={selectedFilePath}
      />

      {sessionId && (
        <RepoSkillsDialog
          open={skillsDialogOpen}
          onOpenChange={setSkillsDialogOpen}
          repoId={repoId}
          sessionId={sessionId}
          directory={repoDirectory}
          onSkillLoaded={(skill) => showToast.success(`Loaded skill: ${skill.name}`)}
        />
      )}

      <RepoMcpDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={repoDirectory}
      />

      <SourceControlPanel
        repoId={repoId}
        isOpen={sourceControlOpen}
        onClose={() => setSourceControlOpen(false)}
        currentBranch={repo?.currentBranch || repo?.branch || "main"}
        repoName={workspaceDisplayName}
      />

      <ResetPermissionsDialog
        open={resetPermissionsOpen}
        onOpenChange={setResetPermissionsOpen}
        repoId={repoId}
      />
    </div>
  );
}
