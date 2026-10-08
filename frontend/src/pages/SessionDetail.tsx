import { useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { FloatingTTSButton } from '@/components/message/FloatingTTSButton'
import { X, CornerUpLeft } from "lucide-react";
import { SquareFill } from "@/components/ui/square-fill";
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
import { copyTextToClipboard } from "@/lib/clipboard";
import { getMessagesContentVersion } from "./sessionContentVersion";
import { showToast } from "@/lib/toast";
import { getWorkspaceFilePath } from "@/lib/markdownLinks";
import { getRepoDisplayName } from "@/lib/utils";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { ProjectActionsMenu } from "@/components/repo/ProjectActionsMenu";
import { RepoActionsDialog } from "@/components/repo/RepoActionsDialog";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { compactSession, forkSession, listSessionMessages } from "@/api/opencode";
import { useSessionStatus } from "@/stores/sessionStatusStore";
import type { PageCommandActions } from "@/lib/builtinCommands";
import { useRedoMessage, useUndoMessage } from "@/hooks/useUndoMessage";
import { usePermissions, useForms } from "@/contexts/EventContext";
import type { FormInfo, SessionMessageInfo } from "@opencode-manager/shared/opencode";
import type { SkillFileInfo } from "@opencode-manager/shared";
import { formatOpenCodeModelRef } from "@opencode-manager/shared/opencode";
import { FormPrompt } from "@/components/session/FormPrompt";
import { MinimizedFormIndicator } from "@/components/session/MinimizedFormIndicator";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { SourceControlPanel } from "@/components/source-control";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { SessionSendErrorBanner } from "@/components/session/SessionSendErrorBanner";
import { BackgroundWorkBar } from "@/components/session/BackgroundWorkBar";
import { SessionGoalBar } from "@/components/session/SessionGoalBar";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useTerminalDialogParam } from "@/hooks/useOpenTerminal";
import { SessionMoreButton } from "@/components/navigation/SessionMoreButton";
import { SideQuestionDialog } from "@/components/session/SideQuestionDialog";
import { SessionMessagePickerDialog } from "@/components/session/SessionMessagePickerDialog";
import { ChangesWalkthroughSheet } from "@/components/session/ChangesWalkthroughSheet";
import { ToolSidePanel } from "@/components/navigation/ToolSidePanel";
import { useToolPanel } from "@/hooks/useToolPanel";

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
  const { open: openSettings, setActiveTab: setSettingsTab } = useSettingsDialog();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [terminalOpen, setTerminalOpen] = useTerminalDialogParam();
  const [actionsDialogOpen, setActionsDialogOpen] = useDialogParam('actions');
  const [previewOpen, setPreviewOpen] = useDialogParam('preview');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [walkthroughOpen, setWalkthroughOpen] = useDialogParam('walkthrough');
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  const [minimizedFormId, setMinimizedFormId] = useState<string | null>(null);
  const [sideQuestion, setSideQuestion] = useState<{ id: number; question: string } | null>(null);
  const [messagePickerMode, setMessagePickerMode] = useState<'fork' | 'timeline' | null>(null);
  const [forkPickerMessages, setForkPickerMessages] = useState<SessionMessageInfo[] | null>(null);
  const [forkPickerLoading, setForkPickerLoading] = useState(false);

  const isMobile = useMobile();
  const docked = !isMobile;
  const sidePanel = useToolPanel(docked);
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

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const revertMessageID = session?.revert?.messageID;

  useEffect(() => {
    if (messagePickerMode !== 'fork' || !sessionId) return;
    let cancelled = false;
    setForkPickerLoading(true);
    setForkPickerMessages(null);
    fetchCompleteSessionHistory(sessionId)
      .then((history) => {
        if (cancelled) return;
        setForkPickerMessages(applyRevertBoundary(history, revertMessageID));
      })
      .catch(() => {
        if (cancelled) return;
        showToast.error('Failed to load messages');
        setMessagePickerMode(null);
      })
      .finally(() => {
        if (cancelled) return;
        setForkPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [messagePickerMode, sessionId, revertMessageID]);

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
  const { mutateAsync: updateSessionAsync } = useUpdateSession(sessionDirectory);
  const { mutateAsync: createSessionAsync } = useCreateSession(sessionDirectory);
  const modelSelectionSession = useMemo(
    () => (sessionId ? { id: sessionId, agent: session?.agent, model: session?.model } : undefined),
    [sessionId, session?.agent, session?.model],
  );
  const { modelRef } = useModelSelection(sessionDirectory, modelSelectionSession);
  const setSessionStatus = useSessionStatus((state) => state.setStatus);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
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

  useAutoPlayLastResponse({
    sessionId: sessionId ?? '',
    lastAssistantMessage,
    lastAssistantText,
    isStreamingResponse,
  });

  const handleShowSessionsDialog = useCallback(() => setSessionsDialogOpen(true), []);
  const handleShowMcpDialog = useCallback(() => setMcpDialogOpen(true), [setMcpDialogOpen]);
  const handleShowSkillsDialog = useCallback(() => setSkillsDialogOpen(true), [setSkillsDialogOpen]);
  const handleShowWalkthrough = useCallback(() => setWalkthroughOpen(true), [setWalkthroughOpen]);
  const handleSkillLoaded = useCallback((skill: SkillFileInfo) => showToast.success(`Loaded skill: ${skill.name}`), []);
  const handleConnectProvider = useCallback(() => setSettingsTab('providers'), [setSettingsTab]);

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
      const newSession = await createSessionAsync({ agent: undefined });
      if (newSession?.id) {
        navigate(`/repos/${repoId}/sessions/${newSession.id}${sessionRouteSuffix}`);
      }
    } catch {
      showToast.error('Failed to create new session');
    }
  }, [createSessionAsync, navigate, repoId, sessionRouteSuffix]);

  const { mutateAsync: undoMessageAsync } = useUndoMessage({
    sessionId: sessionId ?? '',
    directory: sessionDirectory,
    onSuccess: (restoredPrompt) => promptInputRef.current?.setPromptValue(restoredPrompt),
  });
  const { mutateAsync: redoMessageAsync } = useRedoMessage({
    sessionId: sessionId ?? '',
    directory: sessionDirectory,
  });

  const handleCompact = useCallback(async () => {
    if (!sessionId) return;

    const toastId = `compact-${sessionId}`;
    showToast.loading('Compacting session...', { id: toastId });
    setSessionStatus(sessionId, { type: 'compact' });

    try {
      await compactSession(sessionId);
      showToast.success('Compaction requested', { id: toastId });
    } catch (error) {
      showToast.error(`Compact failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { id: toastId });
      setSessionStatus(sessionId, { type: 'idle' });
    }
  }, [sessionId, setSessionStatus]);

  const handleUndo = useCallback(async () => {
    if (!sessionId) return;
    const lastUserMessage = [...messagesRef.current].reverse().find((message) => message.type === 'user');
    if (!lastUserMessage || lastUserMessage.type !== 'user') return;
    try {
      await undoMessageAsync({
        messageID: lastUserMessage.id,
        messageContent: lastUserMessage.text,
      });
    } catch {
      // The undo hook surfaces the failure.
    }
  }, [sessionId, undoMessageAsync]);

  const handleRedo = useCallback(async () => {
    if (!sessionId) return;
    try {
      await redoMessageAsync();
    } catch {
      // The redo hook surfaces the failure.
    }
  }, [sessionId, redoMessageAsync]);

  const openForkPicker = useCallback(() => setMessagePickerMode('fork'), []);

  const handleForkAtMessage = useCallback(async (messageID?: string) => {
    if (!sessionId) return;
    try {
      const forkedSession = await forkSession(sessionId, messageID);
      if (forkedSession?.id) {
        setMessagePickerMode(null);
        navigate(`/repos/${repoId}/sessions/${forkedSession.id}${sessionRouteSuffix}`);
        if (messageID) {
          const chosenMessage = forkPickerMessages?.find((message) => message.id === messageID);
          if (chosenMessage?.type === 'user') {
            promptInputRef.current?.setPromptValue(chosenMessage.text);
          }
        }
        showToast.success('Session forked');
      }
    } catch (error) {
      showToast.error(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sessionId, forkPickerMessages, navigate, repoId, sessionRouteSuffix]);

  const openTimelinePicker = useCallback(() => setMessagePickerMode('timeline'), []);

  const handleJumpToMessage = useCallback((messageID?: string) => {
    setMessagePickerMode(null);
    if (!messageID) return;
    const container = messageContainerRef.current;
    if (!container) return;
    const target = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((element) => element.dataset.messageId === messageID);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const handleCloseSession = useCallback(() => {
    const tab = new URLSearchParams(location.search).get('repoTab') ?? undefined;
    navigate(getSessionListPath(repoId, isAssistantSession, tab))
  }, [navigate, repoId, isAssistantSession, location.search])

  const handleOpenModelDialog = useCallback(() => {
    promptInputRef.current?.openModelPicker();
  }, [])

  const handleInterruptSession = () => {
    if (sessionId) {
      interruptSession.mutate(sessionId);
    }
  };

  const { leaderActive } = useKeyboardShortcuts({
    openModelDialog: handleOpenModelDialog,
    openSessions: handleShowSessionsDialog,
    openSettings,
    newSession: handleNewSession,
    closeSession: handleCloseSession,
    compact: handleCompact,
    undo: handleUndo,
    redo: handleRedo,
    fork: openForkPicker,
    toggleSidebar: () => (docked ? sidePanel.toggleTool('files') : setFileBrowserOpen(!fileBrowserOpen)),
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
    interruptSession: handleInterruptSession,
  });

  

  const handleFileClick = useCallback((filePath: string) => {
    setSelectedFilePath(getWorkspaceFilePath(filePath, {
      directory: sessionDirectory,
      repoFullPath: repo?.fullPath,
      repoLocalPath: repo?.localPath,
    }))
    setFileBrowserOpen(true)
  }, [repo?.fullPath, repo?.localPath, sessionDirectory, setFileBrowserOpen]);

  const handleRenameSession = useCallback(async (title: string) => {
    if (!sessionId) return;
    const trimmedTitle = title.trim();
    try {
      await updateSessionAsync({ sessionID: sessionId, title: trimmedTitle });
      if (!trimmedTitle) {
        showToast.success('Session title regenerated');
      }
    } catch (error) {
      showToast.error(`Rename failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [sessionId, updateSessionAsync]);

  const handleFileBrowserClose = useCallback(() => setFileBrowserOpen(false), [setFileBrowserOpen]);

  const filesVisible = fileBrowserOpen || sidePanel.activeTool === 'files';
  useEffect(() => {
    if (!filesVisible) setSelectedFilePath(undefined);
  }, [filesVisible]);

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
    showToast.success(newValue ? 'Tool details expanded' : 'Tool details collapsed')
  }, [preferences?.expandToolCalls, updateSettings]);

  const buildSessionExport = useCallback(async () => {
    if (!session || !sessionId) {
      throw new Error('No session data to export')
    }
    const history = await fetchCompleteSessionHistory(sessionId)
    return exportSession(
      applyRevertBoundary(history, session.revert?.messageID),
      session,
    )
  }, [session, sessionId]);

  const handleExportSession = useCallback(async () => {
    const result = await buildSessionExport().catch((error: unknown) => {
      showToast.error(
        error instanceof Error && error.message === 'No session data to export'
          ? error.message
          : 'Failed to export session',
      )
      return null
    })
    if (!result) return

    const { filename, content } = result
    if (await downloadMarkdown(content, filename)) {
      showToast.success(`Exported to ${filename}`)
    }
  }, [buildSessionExport]);

  const handleCopyTranscript = useCallback(async () => {
    const copied = await copyTextToClipboard(
      buildSessionExport().then((result) => result.content),
    )
    if (copied) {
      showToast.success('Session transcript copied')
    } else {
      showToast.error('Failed to copy session transcript')
    }
  }, [buildSessionExport]);

  const handleAskSideQuestion = useCallback((question: string) => {
    setSideQuestion({ id: Date.now(), question });
  }, []);

  const commandActions = useMemo<PageCommandActions>(() => ({
    showSessions: handleShowSessionsDialog,
    showModels: handleOpenModelDialog,
    newSession: handleNewSession,
    toggleDetails: handleToggleDetails,
    exportSession: handleExportSession,
    copyTranscript: handleCopyTranscript,
    compact: handleCompact,
    askSideQuestion: handleAskSideQuestion,
    renameSession: handleRenameSession,
    forkSession: openForkPicker,
    jumpToMessage: openTimelinePicker,
    undo: handleUndo,
    redo: handleRedo,
    showMcp: handleShowMcpDialog,
    showSkills: handleShowSkillsDialog,
    showWalkthrough: handleShowWalkthrough,
    showSettings: openSettings,
    connectProvider: handleConnectProvider,
  }), [
    handleShowSessionsDialog,
    handleOpenModelDialog,
    handleNewSession,
    handleToggleDetails,
    handleExportSession,
    handleCopyTranscript,
    handleCompact,
    handleAskSideQuestion,
    handleRenameSession,
    openForkPicker,
    openTimelinePicker,
    handleUndo,
    handleRedo,
    handleShowMcpDialog,
    handleShowSkillsDialog,
    handleShowWalkthrough,
    openSettings,
    handleConnectProvider,
  ]);

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
        <Header className="bg-background [&_button]:bg-background [&_button]:text-foreground [&_button]:border-border [&_button:hover]:bg-accent">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
            {session?.parentID ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleParentSessionClick}
                  className="text-primary hover:text-primary-hover hover:bg-primary/10 h-7 px-2 gap-1"
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
              onChange={handleRenameSession}
              subtitle={<span className="text-highlight">{workspaceDisplayName}</span>}
            />
          </div>
          <Header.Actions className="gap-2 sm:gap-4">
            <div className="flex items-center gap-1">
              {!isAssistantSession && (
                <ProjectActionsMenu repoId={repoId} directory={sessionDirectory} />
              )}
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

      <div className="flex flex-1 min-h-0">
      <div className="relative flex-1 min-w-0 overflow-hidden flex flex-col">
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
              model={modelRef ? formatOpenCodeModelRef(modelRef) : undefined}
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
              <div className="absolute bottom-full right-0 mb-2 z-50 flex flex-col items-end gap-2">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground border border-destructive/60 hover:border-destructive shadow-md shadow-destructive/30 hover:shadow-destructive/50 backdrop-blur-md transition-all duration-200 active:scale-95 hover:scale-105 ring-1 ring-destructive/20 hover:ring-destructive/40"
                    aria-label="Clear"
                  >
                    <X className="w-5 h-5" />
                    <span className="text-sm font-medium hidden sm:inline">Clear</span>
                  </button>
                )}
                {isSessionActive && (
                  <button
                    type="button"
                    onClick={handleInterruptSession}
                    title="Stop"
                    aria-label="Stop"
                    className="md:hidden p-3 rounded-xl transition-all duration-200 active:scale-95 hover:scale-105 bg-destructive hover:bg-destructive/90 text-destructive-foreground border border-destructive/60 shadow-lg shadow-destructive/30"
                  >
                    <SquareFill className="w-5 h-5" />
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
              <SessionGoalBar sessionID={sessionId} />
              <BackgroundWorkBar
                sessionID={sessionId}
                directory={sessionDirectory}
                messages={messages}
                isSessionActive={isSessionActive}
                onChildSessionClick={handleChildSessionClick}
              />
              <PromptInput
                ref={promptInputRef}
                directory={sessionDirectory}
                sessionID={sessionId}
                showScrollButton={showScrollButton && !hasPromptContent}
                isSessionActive={isSessionActive}
                isStreamingResponse={isStreamingResponse}
                onScrollToBottom={scrollToBottom}
                commandActions={commandActions}
                onPromptChange={setHasPromptContent}
              />
            </div>
          </div>
        )}
      </div>
      {docked && (
        <ToolSidePanel
          panel={sidePanel}
          repoId={repoId}
          sessionId={sessionId}
          directory={sessionDirectory}
          filesBasePath={workspaceBasePath}
          currentBranch={repo?.currentBranch || repo?.branch || "main"}
          selectedFilePath={selectedFilePath}
          repoDirectory={repoDirectory}
          onSkillLoaded={handleSkillLoaded}
        />
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

      {sideQuestion && sessionId && (
        <SideQuestionDialog
          key={sideQuestion.id}
          open
          sessionID={sessionId}
          initialQuestion={sideQuestion.question}
          onOpenChange={(open) => {
            if (!open) setSideQuestion(null)
          }}
        />
      )}

      {messagePickerMode && (
        <SessionMessagePickerDialog
          open
          onOpenChange={(open) => {
            if (!open) setMessagePickerMode(null);
          }}
          title={messagePickerMode === 'fork' ? 'Fork session' : 'Jump to message'}
          leadingOptionLabel={messagePickerMode === 'fork' ? 'Entire conversation' : undefined}
          messages={messagePickerMode === 'fork' ? forkPickerMessages ?? [] : messages}
          loading={messagePickerMode === 'fork' && forkPickerLoading}
          onSelect={messagePickerMode === 'fork' ? handleForkAtMessage : handleJumpToMessage}
        />
      )}

      <FileBrowserSheet
        isOpen={!docked && fileBrowserOpen}
        onClose={handleFileBrowserClose}
        basePath={workspaceBasePath}
        repoName={workspaceDisplayName}
        repoId={repoId}
        initialSelectedFile={selectedFilePath}
      />

      {sessionId && (
        <RepoSkillsDialog
          open={!docked && skillsDialogOpen}
          onOpenChange={setSkillsDialogOpen}
          repoId={repoId}
          sessionId={sessionId}
          directory={repoDirectory}
          onSkillLoaded={handleSkillLoaded}
        />
      )}

      {sessionId && (
        <ChangesWalkthroughSheet
          sessionId={sessionId}
          open={!docked && walkthroughOpen}
          onOpenChange={setWalkthroughOpen}
        />
      )}

      <RepoMcpDialog
        open={!docked && mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={repoDirectory}
      />

      {!isAssistantSession && (
        <RepoActionsDialog
          repoId={repoId}
          directory={sessionDirectory}
          open={!docked && actionsDialogOpen}
          onOpenChange={setActionsDialogOpen}
        />
      )}

      <SourceControlPanel
        repoId={repoId}
        isOpen={!docked && sourceControlOpen}
        onClose={() => setSourceControlOpen(false)}
        currentBranch={repo?.currentBranch || repo?.branch || "main"}
        repoName={workspaceDisplayName}
      />

      <TerminalPanel
        repoId={repoId}
        directory={sessionDirectory}
        isOpen={!docked && terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />

      <PreviewPanel
        isOpen={!docked && previewOpen}
        onClose={() => setPreviewOpen(false)}
        directory={sessionDirectory}
      />

      <ResetPermissionsDialog
        open={resetPermissionsOpen}
        onOpenChange={setResetPermissionsOpen}
        repoId={repoId}
      />
    </div>
  );
}
