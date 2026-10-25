import { useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { repoQueryOptions } from "@/lib/repoQuery";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { FloatingTTSButton } from '@/components/message/FloatingTTSButton'
import { X, CornerUpLeft, GitBranch, ArrowDown, Server } from "lucide-react";
import { SquareFill } from "@/components/ui/square-fill";
import { Header } from "@/components/ui/header";
import { Badge } from "@/components/ui/badge";
import { SessionPickerDialog } from "@/components/session/SessionPickerDialog";
import { getServerProjectPath, getSessionListPath, getSessionPath } from '@/lib/navigation'
import { FetchError } from '@/api/fetchWrapper'

import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { NotFoundState } from "@/components/ui/not-found-state";
import { SessionCostIndicator } from "@/components/session/SessionCostIndicator";
import { useSession, useInterruptSession, useUpdateSession, useCreateSession } from "@/hooks/useOpenCode";
import { useSessionTranscript } from "@/hooks/useSessionTranscript";
import { useAutoOpenWalkthrough } from "@/hooks/useAutoOpenWalkthrough";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useRepoSiblings } from "@/hooks/useRepoSiblings";
import { useSSE } from "@/hooks/useSSE";
import { useVcsInfo } from "@/hooks/useVcsInfo";
import { useUIState } from "@/stores/uiStateStore";
import { useSettings } from "@/hooks/useSettings";
import { useModelSelection } from "@/hooks/useModelSelection";
import { useShortcutActions } from "@/contexts/KeyboardShortcutsContext";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useMobile } from "@/hooks/useMobile";
import { useMobileTabBar } from "@/hooks/useMobileTabBar";
import { useToolPanelLayout } from "@/hooks/useToolPanelLayout";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useTTS } from "@/hooks/useTTS";
import { getAssistantText, getLatestPlayableAssistantMessage, useAutoPlayLastResponse } from "@/hooks/useAutoPlayLastResponse";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { MessageSkeleton } from "@/components/message/MessageSkeleton";
import { exportSession, downloadMarkdown } from "@/lib/exportSession";
import { copyTextToClipboard } from "@/lib/clipboard";
import { getMessagesContentVersion } from "./sessionContentVersion";
import { useSpeakVisibleMessages } from "@/hooks/useSpeakVisibleMessages";
import { showToast } from "@/lib/toast";
import { getWorkspaceFilePath } from "@/lib/markdownLinks";
import { getRepoDisplayName, getDirectoryName, cn } from "@/lib/utils";
import { resolveSessionBranch } from "@/lib/activeWork";
import { RepoMcpDialog } from "@/components/repo/RepoMcpDialog";
import { ProjectActionsMenu } from "@/components/repo/ProjectActionsMenu";
import { RepoActionsDialog } from "@/components/repo/RepoActionsDialog";
import { ResetPermissionsDialog } from "@/components/repo/ResetPermissionsDialog";
import { RepoSkillsDialog } from "@/components/repo/RepoSkillsDialog";
import { compactSession, findRemoteProjectForDirectory, forkSession, listSessionMessages, remoteProjectName } from "@/api/opencode";
import { useOpenCodeServerId, isLocalOpenCodeServer } from "@/contexts/OpenCodeServerContext";
import { useRemoteProjects } from "@/hooks/useRemoteProjects";
import { useSwipeNavigation } from "@/contexts/SwipeNavigationContext";
import { useOpenCodeServers, useOpenCodeServerStatuses } from "@/hooks/useOpenCodeServers";
import { serverScopedKey } from "@/lib/serverScope";
import { useSessionStatus } from "@/stores/sessionStatusStore";
import type { PageCommandActions } from "@/lib/builtinCommands";
import { useRedoMessage, useUndoMessage } from "@/hooks/useUndoMessage";
import { usePermissions, useForms } from "@/contexts/EventContext";
import { SessionTranscriptContext, type SessionTranscriptSnapshot } from "@/contexts/session-transcript-context";
import type { FormInfo, SessionMessageInfo } from "@opencode-manager/shared/opencode";
import type { SkillFileInfo } from "@opencode-manager/shared";
import { formatOpenCodeModelRef } from "@opencode-manager/shared/opencode";
import { FormPrompt } from "@/components/session/FormPrompt";
import { clearFormDraft } from "@/lib/formDrafts";
import { MinimizedFormIndicator } from "@/components/session/MinimizedFormIndicator";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { SourceControlPanel, RemoteSourceControlPanel } from "@/components/source-control";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { SessionSendErrorBanner } from "@/components/session/SessionSendErrorBanner";
import { ReconnectingBanner } from "@/components/session/ReconnectingBanner";
import { SessionDetailsSheet } from "@/components/session/SessionDetailsSheet";
import { BackgroundWorkBar } from "@/components/session/BackgroundWorkBar";
import { SessionGoalBar } from "@/components/session/SessionGoalBar";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useTerminalDialogParam } from "@/hooks/useOpenTerminal";
import { SessionMoreButton } from "@/components/navigation/SessionMoreButton";
import { SideQuestionDialog } from "@/components/session/SideQuestionDialog";
import { SessionMessagePickerDialog } from "@/components/session/SessionMessagePickerDialog";
import { ChangesWalkthroughSheet, type WalkthroughSourceRequest } from "@/components/session/ChangesWalkthroughSheet";
import { ToolSidePanel } from "@/components/navigation/ToolSidePanel";
import type { WalkthroughSource } from "@opencode-manager/shared/schemas";
import { useToolPanel } from "@/hooks/useToolPanel";
import { useSessionPickerNavigation } from "@/hooks/useSessionPickerNavigation";

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

async function fetchCompleteSessionHistory(sessionID: string, serverId?: string): Promise<SessionMessageInfo[]> {
  let history: SessionMessageInfo[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (;;) {
    const page = await listSessionMessages(sessionID, cursor === undefined ? {} : { cursor }, serverId)
    const older = page.messages.filter((message) => !seenIds.has(message.id))
    for (const message of older) seenIds.add(message.id)
    history = [...older, ...history]

    if (!page.nextCursor || seenCursors.has(page.nextCursor)) return history
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
}

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof FetchError && (error.statusCode === 400 || error.statusCode === 404)
}

export function SessionDetail() {
  const serverId = useOpenCodeServerId();
  const isRemoteServer = !isLocalOpenCodeServer(serverId);
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const swipeNav = useSwipeNavigation();
  const repoId = Number(id) || 0;
  const isAssistantSession = new URLSearchParams(location.search).get('assistant') === '1';
  const { preferences, updateSettings } = useSettings();
  const { open: openSettings, openTab: openSettingsTab } = useSettingsDialog();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const [messageContainer, setMessageContainer] = useState<HTMLDivElement | null>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [terminalOpen, setTerminalOpen] = useTerminalDialogParam();
  const [actionsDialogOpen, setActionsDialogOpen] = useDialogParam('actions');
  const [previewOpen, setPreviewOpen] = useDialogParam('preview');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [walkthroughOpen, setWalkthroughOpen] = useDialogParam('walkthrough');
  const [requestedWalkthroughSource, setRequestedWalkthroughSource] = useState<WalkthroughSourceRequest | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  const [hasComposerSuggestions, setHasComposerSuggestions] = useState(false);
  const [isVoiceConversationActive, setIsVoiceConversationActive] = useState(false);
  const [minimizedFormId, setMinimizedFormId] = useState<string | null>(null);
  const [sideQuestion, setSideQuestion] = useState<{ id: number; question: string } | null>(null);
  const [messagePickerMode, setMessagePickerMode] = useState<'fork' | 'timeline' | null>(null);
  const [forkPickerMessages, setForkPickerMessages] = useState<SessionMessageInfo[] | null>(null);
  const [forkPickerLoading, setForkPickerLoading] = useState(false);

  const isMobile = useMobile();
  const { open: openMobileSheet } = useMobileTabBar();
  const { docked, showRail } = useToolPanelLayout();
  const sidePanel = useToolPanel(showRail);
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
    ...repoQueryOptions(repoId),
    enabled: id !== undefined && !isRemoteServer,
  });

  useRepoActivity(repoId, Boolean(repo) && !isRemoteServer);

  const repoDirectory = repo?.fullPath;
  const [resolvedSessionDirectory, setResolvedSessionDirectory] = useState<{ sessionId: string; directory: string } | null>(null);
  const resolvedDirectory = (
    resolvedSessionDirectory && resolvedSessionDirectory.sessionId === sessionId
      ? resolvedSessionDirectory.directory
      : undefined
  );
  const sessionDirectory = isRemoteServer ? resolvedDirectory : resolvedDirectory ?? repoDirectory;
  const remoteProjectBackPath = isRemoteServer && sessionDirectory
    ? getServerProjectPath(serverId, sessionDirectory)
    : '/';

  useEffect(() => {
    if (!isRemoteServer) return;
    swipeNav?.setBackTarget(remoteProjectBackPath);
    return () => {
      swipeNav?.setBackTarget(null);
    };
  }, [isRemoteServer, remoteProjectBackPath, swipeNav]);

  const { data: repoSiblings } = useRepoSiblings(!isAssistantSession && !isRemoteServer && repo && !repo.isWorktree ? repoId : undefined);

  const { servers: linkedServers } = useOpenCodeServers({ enabled: isRemoteServer });

  const { projects: remoteProjects } = useRemoteProjects(serverId, { enabled: isRemoteServer });

  const remoteProject = useMemo(() => {
    if (!isRemoteServer || !sessionDirectory) return undefined;
    return findRemoteProjectForDirectory(remoteProjects, sessionDirectory);
  }, [isRemoteServer, remoteProjects, sessionDirectory]);

  const remoteProjectDirectory = isRemoteServer && sessionDirectory
    ? remoteProject?.canonical ?? sessionDirectory
    : undefined;

  const remoteProjectDisplayName = remoteProject ? remoteProjectName(remoteProject) : undefined;

  const sessionBranch = useMemo(
    () => (repo && !isAssistantSession ? resolveSessionBranch(repo, sessionDirectory, repoSiblings) : null),
    [repo, isAssistantSession, sessionDirectory, repoSiblings],
  );

  const { data: remoteVcsInfo } = useVcsInfo(sessionDirectory, serverId, { enabled: isRemoteServer });
  const headerBranch = isRemoteServer ? remoteVcsInfo?.branch.current ?? null : sessionBranch;

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
  const { statusById } = useOpenCodeServerStatuses({ enabled: isRemoteServer });
  const remoteServerConnected = statusById[serverId]?.connected === true;
  const streamConnected = isRemoteServer ? isConnected && remoteServerConnected : isConnected;
  const streamReconnecting = isRemoteServer ? isReconnecting || !remoteServerConnected : isReconnecting;

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

  const transcriptSnapshot = useMemo<SessionTranscriptSnapshot>(
    () => ({ messages, pending: pendingPrompts, status: transcriptStatus }),
    [messages, pendingPrompts, transcriptStatus],
  );

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const revertMessageID = session?.revert?.messageID;

  useEffect(() => {
    if (messagePickerMode !== 'fork' || !sessionId) return;
    let cancelled = false;
    setForkPickerLoading(true);
    setForkPickerMessages(null);
    fetchCompleteSessionHistory(sessionId, serverId)
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
  }, [messagePickerMode, sessionId, revertMessageID, serverId]);

  const messagesContentVersion = useMemo(() => getMessagesContentVersion(messages), [messages]);
  const isTranscriptLoading = repoLoading || sessionLoading || messagesLoading;

  const attachMessageContainer = useCallback((element: HTMLDivElement | null) => {
    messageContainerRef.current = element;
    setMessageContainer(element);
  }, []);

  const { scrollToBottom, scrollByUser } = useAutoScroll({
    container: messageContainer,
    messages,
    sessionId,
    contentVersion: messagesContentVersion,
    isContentReady: !isTranscriptLoading,
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
  const { getForSession: getFormForSession, reply: replyToForm, cancel: cancelForm, syncForSession: syncFormsForSession, forgetPendingActionsForSession } = useForms();
  const currentForm = sessionId ? getFormForSession(sessionId) : null;
  const minimizedForm = currentForm && currentForm.id === minimizedFormId ? currentForm : null;
  const isFormOpen = !!currentForm && !minimizedForm;
  const isFormSheetOpen = isMobile && isFormOpen;

  useEffect(() => {
    if (!sessionId) return;
    if (!isSessionNotFoundError(sessionQueryError)) return;
    forgetPendingActionsForSession(sessionId);
  }, [sessionId, sessionQueryError, forgetPendingActionsForSession]);

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
    enabled: !isVoiceConversationActive,
  });

  const handleShowSessionsDialog = useCallback(() => {
    if (isMobile) {
      openMobileSheet('sessions');
      return;
    }
    setSessionsDialogOpen(true);
  }, [isMobile, openMobileSheet]);
  const handleShowMcpDialog = useCallback(() => setMcpDialogOpen(true), [setMcpDialogOpen]);
  const handleShowSkillsDialog = useCallback(() => setSkillsDialogOpen(true), [setSkillsDialogOpen]);
  const handleShowWalkthrough = useCallback((source?: WalkthroughSource) => {
    setRequestedWalkthroughSource({
      sessionId: sessionId ?? '',
      source,
    });
    setWalkthroughOpen(true);
  }, [sessionId, setWalkthroughOpen]);
  const handleShowWalkthroughCommand = useCallback(() => handleShowWalkthrough(), [handleShowWalkthrough]);
  const walkthroughSourceRequest =
    requestedWalkthroughSource && requestedWalkthroughSource.sessionId === (sessionId ?? '')
      ? requestedWalkthroughSource
      : undefined;
  const handleSkillLoaded = useCallback((skill: SkillFileInfo) => showToast.success(`Loaded skill: ${skill.name}`), []);
  const handleConnectProvider = useCallback(() => openSettingsTab('providers'), [openSettingsTab]);

  useAutoOpenWalkthrough({
    sessionId,
    messages,
    enabled: docked && !isRemoteServer,
    loading: messagesLoading,
    onOpen: handleShowWalkthrough,
  });

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
      clearFormDraft(minimizedFormId)
      setMinimizedFormId(null)
    } catch {
      showToast.error('Failed to dismiss form')
    }
  }, [cancelForm, minimizedFormId])

  const syncPendingActionsForSession = useCallback(async () => {
    if (!sessionDirectory || !sessionId) return
    await Promise.all([
      syncPermissionsForSession(sessionDirectory, sessionId, serverId),
      syncFormsForSession(sessionDirectory, sessionId, serverId),
    ])
  }, [sessionDirectory, sessionId, serverId, syncPermissionsForSession, syncFormsForSession])

  useQuery({
    queryKey: serverScopedKey(['opencode', 'pending-actions', sessionId, sessionDirectory], serverId),
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
        navigate(getSessionPath(repoId, newSession.id, { serverId }));
      }
    } catch {
      showToast.error('Failed to create new session');
    }
  }, [createSessionAsync, navigate, repoId, serverId]);

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
      await compactSession(sessionId, serverId);
      showToast.success('Compaction requested', { id: toastId });
    } catch (error) {
      showToast.error(`Compact failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { id: toastId });
      setSessionStatus(sessionId, { type: 'idle' });
    }
  }, [sessionId, serverId, setSessionStatus]);

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
      const forkedSession = await forkSession(sessionId, messageID, serverId);
      if (forkedSession?.id) {
        setMessagePickerMode(null);
        navigate(getSessionPath(repoId, forkedSession.id, { serverId }));
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
  }, [sessionId, forkPickerMessages, navigate, repoId, serverId]);

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
    if (isRemoteServer) {
      navigate(remoteProjectBackPath)
      return
    }
    const tab = new URLSearchParams(location.search).get('repoTab') ?? undefined;
    navigate(getSessionListPath(repoId, isAssistantSession, tab))
  }, [navigate, repoId, isAssistantSession, isRemoteServer, remoteProjectBackPath, location.search])

  const pickerNavigation = useSessionPickerNavigation({
    mode: 'push',
    onClose: () => setSessionsDialogOpen(false),
    onDeleteActiveSession: isRemoteServer ? handleCloseSession : undefined,
  })

  const handleOpenModelDialog = useCallback(() => {
    promptInputRef.current?.openModelPicker();
  }, [])

  const handleInterruptSession = () => {
    if (sessionId) {
      interruptSession.mutate(sessionId);
    }
  };

  const handleFileClick = useCallback((filePath: string) => {
    setSelectedFilePath(getWorkspaceFilePath(filePath, {
      directory: sessionDirectory,
      repoFullPath: repo?.fullPath,
      repoLocalPath: repo?.localPath,
    }))
    setFileBrowserOpen(true)
  }, [repo?.fullPath, repo?.localPath, sessionDirectory, setFileBrowserOpen]);

  const renameSession = useCallback(async (title: string) => {
    if (!sessionId) throw new Error('No active session');
    await updateSessionAsync({ sessionID: sessionId, title: title.trim() });
  }, [sessionId, updateSessionAsync]);

  const handleRenameSession = useCallback(async (title: string) => {
    const trimmedTitle = title.trim();
    try {
      await renameSession(title);
      if (!trimmedTitle) {
        showToast.success('Session title regenerated');
      }
    } catch (error) {
      showToast.error(`Rename failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [renameSession]);

  const handleFileBrowserClose = useCallback(() => setFileBrowserOpen(false), [setFileBrowserOpen]);

  const filesVisible = fileBrowserOpen || sidePanel.activeTool === 'files';
  useEffect(() => {
    if (!filesVisible) setSelectedFilePath(undefined);
  }, [filesVisible]);

  const handleChildSessionClick = useCallback((childSessionId: string) => {
    navigate(getSessionPath(repoId, childSessionId, { serverId }))
  }, [navigate, repoId, serverId]);

  const handleParentSessionClick = useCallback(() => {
    if (session?.parentID) {
      navigate(getSessionPath(repoId, session.parentID, { serverId }))
    }
  }, [navigate, repoId, session?.parentID, serverId]);

  const handleToggleDetails = useCallback(() => {
    const newValue = !preferences?.expandToolCalls
    updateSettings({ expandToolCalls: newValue })
    showToast.success(newValue ? 'Tool details expanded' : 'Tool details collapsed')
  }, [preferences?.expandToolCalls, updateSettings]);

  const buildSessionExport = useCallback(async () => {
    if (!session || !sessionId) {
      throw new Error('No session data to export')
    }
    const history = await fetchCompleteSessionHistory(sessionId, serverId)
    return exportSession(
      applyRevertBoundary(history, session.revert?.messageID),
      session,
    )
  }, [session, sessionId, serverId]);

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
    showWalkthrough: handleShowWalkthroughCommand,
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
    handleShowWalkthroughCommand,
    openSettings,
    handleConnectProvider,
  ]);

  const handleClearPrompt = useCallback(() => {
    promptInputRef.current?.clearPrompt()
  }, []);

  const scrollMessagesByHalfPage = useCallback((direction: 1 | -1) => {
    const container = messageContainerRef.current;
    if (!container) return;
    scrollByUser((direction * container.clientHeight) / 2);
  }, [scrollByUser]);

  const handleSpeakVisibleMessages = useSpeakVisibleMessages(
    messageContainerRef,
    messages,
    promptOverlayHeight + inputBottomOffset,
  );

  useShortcutActions({
    selectModel: handleOpenModelDialog,
    sessions: handleShowSessionsDialog,
    newSession: handleNewSession,
    closeSession: handleCloseSession,
    compact: handleCompact,
    undo: handleUndo,
    redo: handleRedo,
    fork: openForkPicker,
    timeline: openTimelinePicker,
    exportSession: handleExportSession,
    toggleMode: () => promptInputRef.current?.cycleAgent(),
    variantCycle: () => promptInputRef.current?.cycleVariant(),
    favoriteCycle: () => promptInputRef.current?.cycleFavoriteModel(),
    submit: () => document.querySelector<HTMLButtonElement>("[data-submit-prompt]")?.click(),
    abort: isSessionActive ? handleInterruptSession : undefined,
    clearPrompt: handleClearPrompt,
    halfPageUp: () => scrollMessagesByHalfPage(-1),
    halfPageDown: () => scrollMessagesByHalfPage(1),
    speakVisible: handleSpeakVisibleMessages,
  });

  const handleUndoMessage = useCallback((restoredPrompt: string) => {
    promptInputRef.current?.setPromptValue(restoredPrompt)
  }, []);

  

  

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

  if (!isAssistantSession && !isRemoteServer && repoLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <span className="text-muted-foreground">Loading repository...</span>
        </div>
      </div>
    );
  }

  if (!isAssistantSession && !isRemoteServer && !repo) {
    return <NotFoundState message="Repository not found" backTo="/" backLabel="Back to repositories" />;
  }

  if (isSessionNotFoundError(sessionQueryError)) {
    const listTab = new URLSearchParams(location.search).get('repoTab') ?? undefined;
    return (
      <NotFoundState
        message="Session not found"
        backTo={isRemoteServer ? remoteProjectBackPath : getSessionListPath(repoId, isAssistantSession, listTab)}
        backLabel={isRemoteServer ? 'Back to projects' : 'Back to sessions'}
      />
    );
  }

  if (isRemoteServer) {
    if (sessionQueryError) {
      return (
        <NotFoundState
          message="Failed to load session"
          backTo={remoteProjectBackPath}
          backLabel="Back to projects"
        />
      );
    }

    if (sessionLoading || !sessionDirectory) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <span className="text-muted-foreground">Loading session...</span>
          </div>
        </div>
      );
    }
  }

  const linkedServer = linkedServers.find((candidate) => candidate.id === serverId);
  const projectDisplayName = isRemoteServer
    ? remoteProjectDisplayName ?? (sessionDirectory ? getDirectoryName(sessionDirectory) : 'Project')
    : isAssistantSession || !repo
      ? 'Assistant'
      : getRepoDisplayName(repo);
  const tabFromUrl = new URLSearchParams(location.search).get('repoTab') ?? undefined;
  const sessionBackPath = isRemoteServer
    ? remoteProjectBackPath
    : getSessionListPath(repoId, isAssistantSession, tabFromUrl);

  return (
    <div
      className="h-full max-h-full overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col"
    >
      <div
        data-testid="session-header-region"
        className="flex-shrink-0 overflow-hidden bg-background max-h-72 sm:max-h-80"
      >
        <Header className="bg-background [&_button]:bg-background [&_button]:text-foreground [&_button]:border-border [&_button:hover]:bg-accent">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
            <Header.BackButton to={sessionBackPath} className="text-xs sm:text-sm" />
            <div className="min-w-0 flex-1">
              <h1 className="min-w-0 max-w-full text-xs sm:text-base font-semibold">
                <button
                  type="button"
                  onClick={() => setSessionDetailsOpen(true)}
                  aria-label={`Session details: ${session?.title || "Untitled Session"}`}
                  className="block min-w-0 max-w-full cursor-pointer text-left"
                >
                  <span className="block truncate bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent transition-opacity hover:opacity-80">
                    {session?.title || "Untitled Session"}
                  </span>
                </button>
              </h1>
              {session?.parentID ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleParentSessionClick();
                  }}
                  aria-label="Parent session"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-info/40 px-2 py-0.5 text-[10px] sm:text-xs text-info transition-colors hover:bg-info/10"
                >
                  <CornerUpLeft className="h-3 w-3 shrink-0" />
                  <span className="truncate">Parent session</span>
                </button>
              ) : (
                <p className="flex min-w-0 items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
                  {isRemoteServer && (
                    <Server aria-label="Remote server" className="h-3 w-3 shrink-0 text-highlight" />
                  )}
                  <span className="truncate text-highlight">{projectDisplayName}</span>
                  {headerBranch && (
                    <span className="truncate font-mono sm:hidden"> · {headerBranch}</span>
                  )}
                </p>
              )}
            </div>
            {headerBranch && (
              <Badge
                variant="outline"
                data-testid="session-branch"
                title={`Branch: ${headerBranch}`}
                className="hidden sm:inline-flex max-w-44 shrink-0 items-center gap-1 border-border bg-card px-2 font-mono text-[11px] font-normal text-muted-foreground"
              >
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{headerBranch}</span>
              </Badge>
            )}
          </div>
          <Header.Actions className="gap-2 sm:gap-4">
            <div className="flex items-center gap-1">
              {!isAssistantSession && !isRemoteServer && (
                <ProjectActionsMenu repoId={repoId} directory={sessionDirectory} />
              )}
              <PendingActionsGroup showScheduleReports={!isRemoteServer} />
            </div>
            <SessionCostIndicator sessionID={sessionId} revertMessageID={revertMessageID} />
            <SessionMoreButton />
          </Header.Actions>
        </Header>
        <ReconnectingBanner key={sessionId} connected={streamConnected} />
      </div>

      <div className="flex flex-1 min-h-0">
      <div className="relative flex-1 min-w-0 overflow-hidden flex flex-col">
        <div key={sessionId} data-testid="session-message-scroll" ref={attachMessageContainer} onScroll={handleMessageScroll} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]" style={{ paddingBottom: promptOverlayHeight + inputBottomOffset + PROMPT_OVERLAY_CLEARANCE_PX }}>
          {isTranscriptLoading ? (
            <MessageSkeleton />
          ) : sessionDirectory ? (
            <MessageThread 
              sessionID={sessionId} 
              directory={sessionDirectory}
              repoFullPath={repo?.fullPath}
              repoLocalPath={repo?.localPath}
              messages={messages}
              pending={pendingPrompts}
              isSessionBusy={isSessionActive}
              onFileClick={isRemoteServer ? undefined : handleFileClick}
              onChildSessionClick={handleChildSessionClick}
              onOpenWalkthrough={isRemoteServer ? undefined : handleShowWalkthrough}
              onUndoMessage={handleUndoMessage}
              model={modelRef ? formatOpenCodeModelRef(modelRef) : undefined}
            />
          ) : null}
        </div>
        {sessionDirectory && !isEditingMessage && (
          <div
            data-testid="prompt-overlay"
            className={cn(
              "absolute left-0 right-0 flex justify-center",
              isFormOpen && "top-0 flex-col items-center justify-end pointer-events-none md:pt-3",
            )}
            style={{ bottom: inputBottomOffset }}
          >
            <div
              ref={promptOverlayRef}
              className={cn(
                "relative",
                isFormOpen && "pointer-events-auto",
                isFormSheetOpen
                  ? "flex w-full flex-1 min-h-0 flex-col"
                  : cn("w-full md:w-[94%] md:max-w-4xl", isFormOpen && "flex max-h-full min-h-0 flex-col"),
              )}
            >
              {!isFormSheetOpen && (
                <div className="absolute bottom-full right-[3%] md:right-0 mb-2 z-50 flex flex-col items-end gap-2">
                  {ttsEnabled && !isVoiceConversationActive && !hasPromptContent && !isSessionActive && latestPlayableAssistant && (
                    <FloatingTTSButton
                      messageId={latestPlayableAssistant.messageId}
                      content={latestPlayableAssistant.text}
                      isScrolledUp={showScrollButton}
                      onSpeakVisible={handleSpeakVisibleMessages}
                    />
                  )}
                  {hasPromptContent && !isSessionActive && !hasComposerSuggestions && (
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
              )}
              {showScrollButton && !isFormSheetOpen && (
                <button
                  type="button"
                  aria-label="Jump to latest"
                  title="Jump to latest"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={scrollToBottom}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 size-11 rounded-full bg-card text-foreground border border-border shadow-md flex items-center justify-center transition-all duration-200 active:scale-95 hover:bg-accent"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
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
                  onAskSideQuestion={() => handleAskSideQuestion('')}
                />
              )}
              <div className={cn(isFormSheetOpen && "shrink-0 bg-background px-[3%]")}>
                <div className={cn(!isFormSheetOpen && "px-[3%] md:px-0")}>
                  <SessionSendErrorBanner sessionId={sessionId} isConnected={streamConnected} isReconnecting={streamReconnecting} />
                  <SessionGoalBar sessionID={sessionId} />
                  <BackgroundWorkBar
                    sessionID={sessionId}
                    directory={sessionDirectory}
                    messages={messages}
                    isSessionActive={isSessionActive}
                    onChildSessionClick={handleChildSessionClick}
                  />
                </div>
                <SessionTranscriptContext.Provider value={transcriptSnapshot}>
                  <PromptInput
                    key={sessionId}
                    ref={promptInputRef}
                    directory={sessionDirectory}
                    sessionID={sessionId}
                    onVoiceConversationActiveChange={setIsVoiceConversationActive}
                    onSuggestionsOpenChange={setHasComposerSuggestions}
                    isSessionActive={isSessionActive}
                    isStreamingResponse={isStreamingResponse}
                    onScrollToBottom={scrollToBottom}
                    commandActions={commandActions}
                    onPromptChange={setHasPromptContent}
                  />
                </SessionTranscriptContext.Provider>
              </div>
            </div>
          </div>
        )}
      </div>
      {showRail && (
        <ToolSidePanel
          panel={sidePanel}
          repoId={isRemoteServer ? undefined : repoId}
          sessionId={sessionId}
          directory={sessionDirectory}
          filesBasePath={workspaceBasePath}
          currentBranch={repo?.currentBranch || repo?.branch || "main"}
          selectedFilePath={selectedFilePath}
          repoDirectory={isRemoteServer ? sessionDirectory : repoDirectory}
          terminalTarget={isRemoteServer ? { kind: 'server', serverId } : { kind: 'repo', repoId }}
          onSkillLoaded={handleSkillLoaded}
          walkthroughSourceRequest={walkthroughSourceRequest}
          walkthroughModel={modelRef}
          walkthroughOnOpenSession={handleChildSessionClick}
        />
      )}
      </div>

      {/* Sessions Picker */}
      <SessionPickerDialog
        open={sessionsDialogOpen}
        onOpenChange={setSessionsDialogOpen}
        currentRepo={isRemoteServer ? undefined : repo}
        activeSessionID={sessionId || undefined}
        remote={
          isRemoteServer
            ? {
                serverId,
                serverName: linkedServer?.name,
                projectDirectory: remoteProjectDirectory,
                isPending: sessionLoading,
              }
            : undefined
        }
        {...pickerNavigation}
      />

      <SessionDetailsSheet
        open={sessionDetailsOpen}
        onOpenChange={setSessionDetailsOpen}
        title={session?.title}
        serverName={linkedServer?.name}
        remote={isRemoteServer}
        project={projectDisplayName}
        branch={headerBranch}
        directory={sessionDirectory}
        onRename={renameSession}
      />

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

      {!isRemoteServer && (
        <FileBrowserSheet
          isOpen={!docked && fileBrowserOpen}
          onClose={handleFileBrowserClose}
          basePath={workspaceBasePath}
          repoName={projectDisplayName}
          repoId={repoId}
          initialSelectedFile={selectedFilePath}
        />
      )}

      {sessionId && (
        <RepoSkillsDialog
          open={!docked && skillsDialogOpen}
          onOpenChange={setSkillsDialogOpen}
          repoId={repoId}
          sessionId={sessionId}
          directory={isRemoteServer ? sessionDirectory : repoDirectory}
          onSkillLoaded={handleSkillLoaded}
        />
      )}

      {!isRemoteServer && sessionId && (
        <ChangesWalkthroughSheet
          sessionId={sessionId}
          open={!docked && walkthroughOpen}
          onOpenChange={setWalkthroughOpen}
          sourceRequest={walkthroughSourceRequest}
          model={modelRef}
          onOpenSession={handleChildSessionClick}
        />
      )}

      <RepoMcpDialog
        open={!docked && mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={isRemoteServer ? sessionDirectory : repoDirectory}
      />

      {!isAssistantSession && !isRemoteServer && (
        <RepoActionsDialog
          repoId={repoId}
          directory={sessionDirectory}
          open={!docked && actionsDialogOpen}
          onOpenChange={setActionsDialogOpen}
        />
      )}

      {isRemoteServer
        ? sessionDirectory && (
          <RemoteSourceControlPanel
            serverId={serverId}
            directory={sessionDirectory}
            isOpen={!docked && sourceControlOpen}
            onClose={() => setSourceControlOpen(false)}
          />
        )
        : (
          <SourceControlPanel
            repoId={repoId}
            isOpen={!docked && sourceControlOpen}
            onClose={() => setSourceControlOpen(false)}
            currentBranch={repo?.currentBranch || repo?.branch || "main"}
            repoName={projectDisplayName}
          />
        )}

      <TerminalPanel
        target={isRemoteServer ? { kind: 'server', serverId } : { kind: 'repo', repoId }}
        directory={sessionDirectory}
        isOpen={!docked && terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />

      {!isRemoteServer && (
        <PreviewPanel
          isOpen={!docked && previewOpen}
          onClose={() => setPreviewOpen(false)}
          directory={sessionDirectory}
        />
      )}

      {!isRemoteServer && (
        <ResetPermissionsDialog
          open={resetPermissionsOpen}
          onOpenChange={setResetPermissionsOpen}
          repoId={repoId}
        />
      )}
    </div>
  );
}
