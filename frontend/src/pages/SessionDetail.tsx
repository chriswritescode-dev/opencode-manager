import { useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo, initializeAssistantMode } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { FloatingTTSButton } from '@/components/message/FloatingTTSButton'
import { X, CornerUpLeft } from "lucide-react";
import { ModelSelectDialog } from "@/components/model/ModelSelectDialog";
import { Header } from "@/components/ui/header";
import { SessionList } from "@/components/session/SessionList";
import { getSessionListPath } from '@/lib/navigation'

import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { useSession, useAbortSession, useUpdateSession, useMessages, useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { OPENCODE_API_ENDPOINT } from "@/config";
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
import type { MessageWithParts } from "@/api/types";
import { showToast } from "@/lib/toast";
import { getRepoDisplayName } from "@/lib/utils";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { RepoLspDialog } from "@/components/repo/RepoLspDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { createOpenCodeClient } from "@/api/opencode";
import { useSessionStatus, useSessionStatusForSession } from "@/stores/sessionStatusStore";
import { usePermissions, useQuestions, useSSEHealth } from "@/contexts/EventContext";
import type { QuestionRequest } from "@/api/types";
import { QuestionPrompt } from "@/components/session/QuestionPrompt";
import { MinimizedQuestionIndicator } from "@/components/session/MinimizedQuestionIndicator";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { SourceControlPanel } from "@/components/source-control";
import { SessionSendErrorBanner } from "@/components/session/SessionSendErrorBanner";
import { SessionTodoDisplay } from "@/components/message/SessionTodoDisplay";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { SessionMoreButton } from "@/components/navigation/SessionMoreButton";

const compareMessageIds = (id1: string, id2: string): number => {
  const num1 = parseInt(id1, 10)
  const num2 = parseInt(id2, 10)
  if (!isNaN(num1) && !isNaN(num2)) return num1 - num2
  return id1.localeCompare(id2)
}

const PENDING_ACTION_SYNC_INTERVAL_MS = 30000

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
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [lspDialogOpen, setLspDialogOpen] = useDialogParam('lsp');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  const [minimizedQuestion, setMinimizedQuestion] = useState<QuestionRequest | null>(null);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastHeaderScrollTopRef = useRef(0);

  const isMobile = useMobile();
  const { keyboardHeight } = useVisualViewport();
  const inputBottomOffset = isMobile ? keyboardHeight : 0;
  const promptOverlayRef = useRef<HTMLDivElement>(null);
  const [promptOverlayHeight, setPromptOverlayHeight] = useState(112);

  useEffect(() => {
    const el = promptOverlayRef.current;
    if (!el) return;
    let mounted = true;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && mounted) {
        setPromptOverlayHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, []);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  const { data: assistantMode, isLoading: assistantModeLoading } = useQuery({
    queryKey: ["repo", repoId, "assistant-mode"],
    queryFn: () => initializeAssistantMode(repoId),
    enabled: isAssistantSession,
  });

  useRepoActivity(repoId, Boolean(repo));

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = isAssistantSession ? (assistantMode?.directory || repo?.fullPath) : repo?.fullPath;
  const sessionRouteSuffix = isAssistantSession ? '?assistant=1' : '';

  const { isConnected, isReconnecting } = useSSE(opcodeUrl, repoDirectory, sessionId);
  const sseHealth = useSSEHealth();
  const sessionStatus = useSessionStatusForSession(sessionId);
  const isSessionActive = sessionStatus.type === 'busy' || sessionStatus.type === 'compact' || sessionStatus.type === 'retry';

  const { data: rawMessages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionId, repoDirectory, { fallbackPoll: !sseHealth.isHealthy && isSessionActive });
  const { data: session, isLoading: sessionLoading } = useSession(
    opcodeUrl,
    sessionId,
    repoDirectory,
  );

  const messages = useMemo(() => {
    if (!rawMessages) return undefined
    const revertMessageID = session?.revert?.messageID
    if (!revertMessageID) return rawMessages
    return rawMessages.filter(msgWithParts => compareMessageIds(msgWithParts.info.id, revertMessageID) < 0)
  }, [rawMessages, session?.revert?.messageID]);

  const getMessagesWithParts = useCallback((): MessageWithParts[] | undefined => {
    return messages
  }, [messages])

  const { scrollToBottom } = useAutoScroll({
    containerRef: messageContainerRef,
    messages: messages?.map(m => m.info),
    sessionId,
    contentVersion: messages?.reduce((sum, m) => sum + m.parts.length, 0) ?? 0,
    onScrollStateChange: setShowScrollButton
  });
  const abortSession = useAbortSession(opcodeUrl, repoDirectory, sessionId);
  const updateSession = useUpdateSession(opcodeUrl, repoDirectory);
  const createSession = useCreateSession(opcodeUrl, repoDirectory);
  const { model, modelString } = useModelSelection(opcodeUrl, repoDirectory);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
  const setActivePromptFileBasePath = useUIState((state) => state.setActivePromptFileBasePath);
  const { isEnabled: ttsEnabled } = useTTS();
  const setSessionStatus = useSessionStatus((state) => state.setStatus);
  const { syncForSession: syncPermissionsForSession } = usePermissions();
  const { current: currentQuestion, reply: replyToQuestion, reject: rejectQuestion, syncForSession: syncQuestionsForSession } = useQuestions();

  const lastAssistantMessage = messages?.filter(m => m.info.role === 'assistant').at(-1);
  const lastAssistantText = getAssistantText(lastAssistantMessage);
  const latestPlayableAssistant = useMemo(() => getLatestPlayableAssistantMessage(messages), [messages]);
  const hasIncompleteMessages = lastAssistantMessage ? !('completed' in lastAssistantMessage.info.time && lastAssistantMessage.info.time.completed) : false;
  const isStreamingResponse = hasIncompleteMessages && isSessionActive;
  const assistantFileBasePath = assistantMode?.directory.split('/').filter(Boolean).at(-1);
  const workspaceBasePath = (isAssistantSession ? assistantFileBasePath : repo?.localPath) ?? repo?.localPath;

  useEffect(() => {
    setActivePromptFileBasePath(repoDirectory ? workspaceBasePath ?? null : null)

    return () => {
      setActivePromptFileBasePath(null)
    }
  }, [repoDirectory, setActivePromptFileBasePath, workspaceBasePath])

  useAutoPlayLastResponse({
    sessionId: sessionId ?? '',
    lastAssistantMessage,
    lastAssistantText,
    isStreamingResponse,
  });

  const handleShowModelsDialog = useCallback(() => setModelDialogOpen(true), []);
  const handleShowSessionsDialog = useCallback(() => setSessionsDialogOpen(true), []);
  const handleShowHelpDialog = useCallback(() => openSettings(), [openSettings]);

  const handleMinimizeQuestion = useCallback((question: QuestionRequest) => {
    setMinimizedQuestion(question)
  }, [])
  
  const handleRestoreQuestion = useCallback(() => {
    setMinimizedQuestion(null)
  }, [])

  useEffect(() => {
    if (minimizedQuestion && minimizedQuestion.sessionID !== sessionId) {
      setMinimizedQuestion(null)
    }
  }, [sessionId, minimizedQuestion])

  useEffect(() => {
    const container = messageContainerRef.current
    if (!container) return

    lastHeaderScrollTopRef.current = container.scrollTop
    setIsHeaderVisible(true)

    const handleScroll = () => {
      if (!isMobile) {
        setIsHeaderVisible(true)
        return
      }
      const currentScrollTop = container.scrollTop
      const previousScrollTop = lastHeaderScrollTopRef.current
      const maxScrollTop = container.scrollHeight - container.clientHeight
      const isAtBottom = maxScrollTop - currentScrollTop < 24
      const isScrollingDown = currentScrollTop > previousScrollTop + 4
      const isScrollingUp = currentScrollTop < previousScrollTop - 50

      if (isAtBottom || isScrollingDown) {
        setIsHeaderVisible(true)
      } else if (isScrollingUp) {
        setIsHeaderVisible(false)
      }

      lastHeaderScrollTopRef.current = currentScrollTop
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [repoDirectory, sessionId, isMobile])

  const syncPendingActionsForSession = useCallback(async () => {
    if (!repoDirectory || !sessionId) return
    await Promise.all([
      syncPermissionsForSession(repoDirectory, sessionId),
      syncQuestionsForSession(repoDirectory, sessionId),
    ])
  }, [repoDirectory, sessionId, syncPermissionsForSession, syncQuestionsForSession])

  useQuery({
    queryKey: ['opencode', 'pending-actions', opcodeUrl, sessionId, repoDirectory],
    queryFn: async () => {
      await syncPendingActionsForSession()
      return null
    },
    enabled: !!repoDirectory && !!sessionId,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: !sseHealth.isHealthy && (isSessionActive || hasIncompleteMessages) ? PENDING_ACTION_SYNC_INTERVAL_MS : false,
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

  const handleCompact = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    if (!model?.providerID || !model?.modelID) {
      showToast.error('No model selected. Please select a provider and model first.');
      return;
    }

    showToast.loading('Compacting session...', { id: `compact-${sessionId}` });
    setSessionStatus(sessionId, { type: 'compact' });

    try {
      const client = createOpenCodeClient(opcodeUrl, repoDirectory);
      await client.summarizeSession(sessionId, model.providerID, model.modelID);
    } catch (error) {
      showToast.error(`Compact failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSessionStatus(sessionId, { type: 'idle' });
    }
  }, [opcodeUrl, sessionId, model, repoDirectory, setSessionStatus]);

  const handleUndo = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, repoDirectory);
      await client.sendCommand(sessionId, { command: 'undo', arguments: '' });
    } catch (error) {
      showToast.error(`Undo failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [opcodeUrl, sessionId, repoDirectory]);

  const handleRedo = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, repoDirectory);
      await client.sendCommand(sessionId, { command: 'redo', arguments: '' });
    } catch (error) {
      showToast.error(`Redo failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [opcodeUrl, sessionId, repoDirectory]);

  const handleFork = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, repoDirectory);
      const forkedSession = await client.forkSession(sessionId);
      if (forkedSession?.id) {
        navigate(`/repos/${repoId}/sessions/${forkedSession.id}${sessionRouteSuffix}`);
        showToast.success('Session forked');
      }
    } catch (error) {
      showToast.error(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [opcodeUrl, sessionId, repoDirectory, navigate, repoId, sessionRouteSuffix]);

  const handleCloseSession = useCallback(() => {
    navigate(getSessionListPath(repoId, isAssistantSession))
  }, [navigate, repoId, isAssistantSession])

  const { leaderActive } = useKeyboardShortcuts({
    openModelDialog: () => setModelDialogOpen(true),
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
    abortSession: () => {
      if (sessionId) {
        abortSession.mutate(sessionId);
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

  const handleExportSession = useCallback(() => {
    const data = getMessagesWithParts()
    if (!data || !session) {
      showToast.error('No session data to export')
      return
    }
    
    const { filename, content } = exportSession(data, session)
    downloadMarkdown(content, filename)
    showToast.success(`Exported to ${filename}`)
  }, [getMessagesWithParts, session]);

  const handleUndoMessage = useCallback((restoredPrompt: string) => {
    promptInputRef.current?.setPromptValue(restoredPrompt)
  }, []);

  const handleClearPrompt = useCallback(() => {
    promptInputRef.current?.clearPrompt()
  }, []);

  

  

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

  if (!repo && !isAssistantSession) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <span className="text-muted-foreground">Loading repository...</span>
        </div>
      </div>
    );
  }

  const workspaceDisplayName = isAssistantSession || !repo
    ? 'Assistant'
    : getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath);
  const sessionBackPath = getSessionListPath(repoId, isAssistantSession);

  return (
    <div
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
    >
      <div
        data-testid="session-header-region"
        className={`flex-shrink-0 overflow-hidden bg-background transition-all duration-200 ease-out ${
          isHeaderVisible
            ? 'max-h-72 sm:max-h-80 opacity-100 translate-y-0'
            : 'max-h-0 opacity-0 -translate-y-2'
        }`}
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
              opcodeUrl={opcodeUrl}
              sessionID={sessionId}
              directory={repoDirectory}
              isConnected={isConnected}
              isReconnecting={isReconnecting}
            />
            <SessionMoreButton />
          </Header.Actions>
        </Header>

        <div className="px-3 sm:px-4">
          <SessionTodoDisplay sessionID={sessionId} />
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden flex flex-col">
        <div key={sessionId} ref={messageContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]" style={{ paddingBottom: promptOverlayHeight + inputBottomOffset + 16 }}>
          {repoLoading || assistantModeLoading || sessionLoading || messagesLoading ? (
            <MessageSkeleton />
          ) : opcodeUrl && repoDirectory ? (
            <MessageThread 
              opcodeUrl={opcodeUrl} 
              sessionID={sessionId} 
              directory={repoDirectory}
              messages={messages}
              onFileClick={handleFileClick}
              onChildSessionClick={handleChildSessionClick}
              onUndoMessage={handleUndoMessage}
              model={modelString || undefined}
            />
          ) : null}
        </div>
        {opcodeUrl && repoDirectory && !isEditingMessage && (
          <div
            ref={promptOverlayRef}
            className="absolute left-0 right-0 flex justify-center"
            style={{ bottom: inputBottomOffset }}
          >
            <div className="relative w-[94%] md:max-w-4xl">
              <div className="absolute -top-5 right-0 md:right-4 z-50 flex flex-col items-end gap-2">
                {ttsEnabled && !hasPromptContent && !isSessionActive && latestPlayableAssistant && (
                  <FloatingTTSButton
                    messageId={latestPlayableAssistant.message.info.id}
                    content={latestPlayableAssistant.text}
                  />
                )}
                {hasPromptContent && (
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
              {minimizedQuestion && minimizedQuestion.sessionID === sessionId && (
                <MinimizedQuestionIndicator
                  question={minimizedQuestion}
                  onRestore={handleRestoreQuestion}
                  onDismiss={() => rejectQuestion(minimizedQuestion.id)}
                />
              )}
              {!minimizedQuestion && currentQuestion && currentQuestion.sessionID === sessionId && (
                <QuestionPrompt
                  key={currentQuestion.id}
                  question={currentQuestion}
                  onReply={replyToQuestion}
                  onReject={rejectQuestion}
                  onMinimize={() => handleMinimizeQuestion(currentQuestion)}
                />
              )}
              <SessionSendErrorBanner sessionId={sessionId} />
              <PromptInput
                ref={promptInputRef}
                opcodeUrl={opcodeUrl}
                directory={repoDirectory}
                sessionID={sessionId}
                disabled={!isConnected}
                showScrollButton={showScrollButton}
                isSessionActive={isSessionActive}
                isStreamingResponse={isStreamingResponse}
                onScrollToBottom={scrollToBottom}
                onShowModelsDialog={handleShowModelsDialog}
                onShowSessionsDialog={handleShowSessionsDialog}
                onShowHelpDialog={handleShowHelpDialog}
                onToggleDetails={handleToggleDetails}
                onExportSession={handleExportSession}
                onPromptChange={setHasPromptContent}
              />
            </div>
          </div>
        )}
      </div>

      <ModelSelectDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        opcodeUrl={opcodeUrl}
        directory={repoDirectory}
      />

      {/* Sessions Dialog */}
      <Dialog open={sessionsDialogOpen} onOpenChange={setSessionsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogTitle>Sessions</DialogTitle>
          <div className="overflow-y-auto max-h-[60vh] mt-4">
            {opcodeUrl && (
              <SessionList
                opcodeUrl={opcodeUrl}
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

      <RepoLspDialog
        open={lspDialogOpen}
        onOpenChange={setLspDialogOpen}
        opcodeUrl={opcodeUrl}
        directory={repoDirectory}
      />

      {opcodeUrl && sessionId && (
        <RepoSkillsDialog
          open={skillsDialogOpen}
          onOpenChange={setSkillsDialogOpen}
          repoId={repoId}
          sessionId={sessionId}
          opcodeUrl={opcodeUrl}
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
        repoDirectory={repoDirectory}
      />
    </div>
  );
}
