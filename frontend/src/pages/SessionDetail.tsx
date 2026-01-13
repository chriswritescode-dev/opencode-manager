import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { X, VolumeX, FolderOpen, Plug, Settings, Upload, CornerUpLeft } from "lucide-react";
import { ModelSelectDialog } from "@/components/model/ModelSelectDialog";
import { Header } from "@/components/ui/header";
import { SessionList } from "@/components/session/SessionList";

import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BranchSwitcher } from "@/components/repo/BranchSwitcher";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { useSession, useAbortSession, useUpdateSession, useMessages, useTitleGenerating, useCreateSession } from "@/hooks/useOpenCode";
import { OPENCODE_API_ENDPOINT, API_BASE_URL } from "@/config";
import { useSSE } from "@/hooks/useSSE";
import { useUIState } from "@/stores/uiStateStore";
import { useSettings } from "@/hooks/useSettings";
import { useModelSelection } from "@/hooks/useModelSelection";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useSwipeBack } from "@/hooks/useMobile";
import { useTTS } from "@/hooks/useTTS";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { MessageSkeleton } from "@/components/message/MessageSkeleton";
import { exportSession, downloadMarkdown } from "@/lib/exportSession";
import { showToast } from "@/lib/toast";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { createOpenCodeClient } from "@/api/opencode";
import { useSessionStatus } from "@/stores/sessionStatusStore";
import { useQuestions } from "@/contexts/EventContext";
import { QuestionPrompt } from "@/components/session/QuestionPrompt";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";

const compareMessageIds = (id1: string, id2: string): number => {
  const num1 = parseInt(id1, 10)
  const num2 = parseInt(id2, 10)
  if (!isNaN(num1) && !isNaN(num2)) return num1 - num2
  return id1.localeCompare(id2)
}

export function SessionDetail() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const repoId = parseInt(id || "0");
  const { preferences, updateSettings } = useSettings();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  
  const handleSwipeBack = useCallback(() => {
    navigate(`/repos/${repoId}`);
  }, [navigate, repoId]);
  
  const { bind: bindSwipe, swipeStyles } = useSwipeBack(handleSwipeBack, {
    enabled: !fileBrowserOpen && !modelDialogOpen && !sessionsDialogOpen,
  });
  
  useEffect(() => {
    return bindSwipe(pageRef.current);
  }, [bindSwipe]);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  const { data: settings } = useQuery({
    queryKey: ["opencode-config"],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/api/settings/opencode-configs/default`);
      if (!response.ok) throw new Error("Failed to fetch config");
      return response.json();
    },
  });

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = repo?.fullPath;

  const { data: rawMessages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionId, repoDirectory);
  const { data: session, isLoading: sessionLoading } = useSession(
    opcodeUrl,
    sessionId,
    repoDirectory,
  );

  const messages = useMemo(() => {
    if (!rawMessages) return undefined
    const revertMessageID = session?.revert?.messageID
    if (!revertMessageID) return rawMessages
    return rawMessages.filter(msg => compareMessageIds(msg.info.id, revertMessageID) < 0)
  }, [rawMessages, session?.revert?.messageID]);

  const { scrollToBottom } = useAutoScroll({
    containerRef: messageContainerRef,
    messages,
    sessionId,
    onScrollStateChange: setShowScrollButton
  });

  const { isConnected, isReconnecting } = useSSE(opcodeUrl, repoDirectory);
  const abortSession = useAbortSession(opcodeUrl, repoDirectory, sessionId);
  const updateSession = useUpdateSession(opcodeUrl, repoDirectory);
  const createSession = useCreateSession(opcodeUrl, repoDirectory);
  const isTitleGenerating = useTitleGenerating(sessionId);
  const { open: openSettings } = useSettingsDialog();
  const { model, modelString } = useModelSelection(opcodeUrl, repoDirectory);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
  const { isPlaying, stop } = useTTS();
  const setSessionStatus = useSessionStatus((state) => state.setStatus);
  const { current: currentQuestion, reply: replyToQuestion, reject: rejectQuestion } = useQuestions();

  const handleNewSession = useCallback(async () => {
    try {
      const newSession = await createSession.mutateAsync({ agent: undefined });
      if (newSession?.id) {
        navigate(`/repos/${repoId}/sessions/${newSession.id}`);
      }
    } catch {
      showToast.error('Failed to create new session');
    }
  }, [createSession, navigate, repoId]);

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
        navigate(`/repos/${repoId}/sessions/${forkedSession.id}`);
        showToast.success('Session forked');
      }
    } catch (error) {
      showToast.error(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [opcodeUrl, sessionId, repoDirectory, navigate, repoId]);

  const handleCloseSession = useCallback(() => {
    navigate(`/repos/${repoId}`);
  }, [navigate, repoId]);

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
    toggleSidebar: () => setFileBrowserOpen(prev => !prev),
    toggleMode: () => {
      const newMode = preferences?.mode === "plan" ? "build" : "plan";
      updateSettings({ mode: newMode });
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
  }, [repo?.fullPath]);

  const handleSessionTitleUpdate = useCallback((newTitle: string) => {
    if (sessionId) {
      updateSession.mutate({ sessionID: sessionId, title: newTitle });
    }
  }, [sessionId, updateSession]);

  const handleFileBrowserClose = useCallback(() => {
    setFileBrowserOpen(false)
    setSelectedFilePath(undefined)
  }, []);

  const handleChildSessionClick = useCallback((childSessionId: string) => {
    navigate(`/repos/${repoId}/sessions/${childSessionId}`)
  }, [navigate, repoId]);

  const handleParentSessionClick = useCallback(() => {
    if (session?.parentID) {
      navigate(`/repos/${repoId}/sessions/${session.parentID}`)
    }
  }, [navigate, repoId, session?.parentID]);

  const handleToggleDetails = useCallback(() => {
    const newValue = !preferences?.expandToolCalls
    updateSettings({ expandToolCalls: newValue })
    return newValue
  }, [preferences?.expandToolCalls, updateSettings]);

  const handleExportSession = useCallback(() => {
    if (!messages || !session) {
      showToast.error('No session data to export')
      return
    }
    
    const { filename, content } = exportSession(messages, session)
    downloadMarkdown(content, filename)
    showToast.success(`Exported to ${filename}`)
  }, [messages, session]);

  const handleUndoMessage = useCallback((restoredPrompt: string) => {
    promptInputRef.current?.setPromptValue(restoredPrompt)
  }, []);

  const handleClearPrompt = useCallback(() => {
    promptInputRef.current?.clearPrompt()
  }, []);

  const handleAttachFile = useCallback(() => {
    promptInputRef.current?.triggerFileUpload()
  }, []);

  

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background text-muted-foreground">
        Session not found
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <span className="text-muted-foreground">Loading repository...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
      style={swipeStyles}
    >
      <Header>
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
                <Header.BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
              </div>
            </>
          ) : (
            <Header.BackButton to={`/repos/${repoId}`} className="text-xs sm:text-sm" />
          )}
          <Header.EditableTitle
            value={session?.title || "Untitled Session"}
            onChange={handleSessionTitleUpdate}
            subtitle={repo.repoUrl?.split("/").pop()?.replace(".git", "") || repo.localPath || "Repository"}
            generating={isTitleGenerating}
          />
        </div>
        <Header.Actions className="gap-2 sm:gap-4">
          <div className="hidden sm:flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <ContextUsageIndicator
            opcodeUrl={opcodeUrl}
            sessionID={sessionId}
            directory={repoDirectory}
            isConnected={isConnected}
            isReconnecting={isReconnecting}
          />
          <BranchSwitcher
            repoId={repoId}
            currentBranch={repo.currentBranch || "main"}
            isWorktree={repo.isWorktree}
            repoUrl={repo.repoUrl}
            repoLocalPath={repo.localPath}
            className="hidden sm:flex max-w-[80px] sm:w-[140px] sm:max-w-[140px]"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFileBrowserOpen(true)}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Files"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMcpDialogOpen(true)}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="MCP Servers"
          >
            <Plug className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openSettings}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Header.MobileDropdown>
            <div className="px-2 py-1.5">
              <BranchSwitcher
                repoId={repoId}
                currentBranch={repo.currentBranch || "main"}
                isWorktree={repo.isWorktree}
                repoUrl={repo.repoUrl}
                repoLocalPath={repo.localPath}
                iconOnly={false}
                className="w-full"
              />
            </div>
            <div className="h-px bg-border my-1" />
            <DropdownMenuItem onClick={() => setFileBrowserOpen(true)}>
              <FolderOpen className="w-4 h-4 mr-2" /> Files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleAttachFile}>
              <Upload className="w-4 h-4 mr-2" /> Upload
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMcpDialogOpen(true)}>
              <Plug className="w-4 h-4 mr-2" /> MCP
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openSettings}>
              <Settings className="w-4 h-4 mr-2" /> Settings
            </DropdownMenuItem>
          </Header.MobileDropdown>
        </Header.Actions>
      </Header>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div key={sessionId} ref={messageContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-28 overscroll-contain">
          {repoLoading || sessionLoading || messagesLoading ? (
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
          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <div className="relative w-[94%] md:max-w-4xl">
              {hasPromptContent && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchEnd={(e) => {
                    e.preventDefault()
                    handleClearPrompt()
                  }}
                  onClick={handleClearPrompt}
                  className="absolute -top-12 right-0 md:right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border-2 border-red-500/60 hover:border-red-400 shadow-lg shadow-red-500/30 hover:shadow-red-500/50 backdrop-blur-md transition-all duration-200 active:scale-95 hover:scale-105 ring-2 ring-red-500/20 hover:ring-red-500/40"
                  aria-label="Clear"
                >
                  <X className="w-6 h-6" />
                  <span className="text-sm font-medium hidden sm:inline">Clear</span>
                </button>
              )}
              {leaderActive && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-primary/90 text-primary-foreground border border-primary shadow-lg backdrop-blur-md animate-pulse">
                  <span className="text-sm font-medium">Waiting for shortcut key...</span>
                </div>
              )}
              {isPlaying && !leaderActive && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchEnd={(e) => {
                    e.preventDefault()
                    stop()
                  }}
                  onClick={stop}
                  className="absolute -top-12 left-0 md:left-4 z-50 flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-br from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 text-destructive-foreground border-2 border-red-600/80 hover:border-red-500 shadow-2xl shadow-red-600/40 hover:shadow-red-600/60 backdrop-blur-md transition-all duration-200 active:scale-95 hover:scale-105 ring-2 ring-red-600/30 hover:ring-red-600/50 animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"
                  aria-label="Stop Audio"
                >
                  <VolumeX className="w-6 h-6" />
                  <span className="text-sm font-medium hidden sm:inline">Stop Audio</span>
                </button>
              )}
              {currentQuestion && currentQuestion.sessionID === sessionId && (
                <QuestionPrompt
                  key={currentQuestion.id}
                  question={currentQuestion}
                  onReply={replyToQuestion}
                  onReject={rejectQuestion}
                />
              )}
              <PromptInput
                ref={promptInputRef}
                opcodeUrl={opcodeUrl}
                directory={repoDirectory}
                sessionID={sessionId}
                disabled={!isConnected}
                showScrollButton={showScrollButton}
                onScrollToBottom={scrollToBottom}
                onShowModelsDialog={() => setModelDialogOpen(true)}
                onShowSessionsDialog={() => setSessionsDialogOpen(true)}
                onShowHelpDialog={() => {
                  openSettings()
                }}
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
                  navigate(`/repos/${repoId}/sessions/${sessionID}`)
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
        basePath={repo.localPath}
        repoName={repo.repoUrl?.split("/").pop()?.replace(".git", "") || repo.localPath || "Repository"}
        initialSelectedFile={selectedFilePath}
      />

      <RepoMcpDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        config={settings}
        directory={repoDirectory}
      />
    </div>
  );
}
