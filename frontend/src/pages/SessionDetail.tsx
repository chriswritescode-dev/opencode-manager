import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput } from "@/components/message/PromptInput";
import { ModelSelectDialog } from "@/components/model/ModelSelectDialog";
import { SessionDetailHeader } from "@/components/session/SessionDetailHeader";
import { SessionList } from "@/components/session/SessionList";
import { PermissionRequestDialog } from "@/components/session/PermissionRequestDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSession, useAbortSession, useUpdateSession, useOpenCodeClient } from "@/hooks/useOpenCode";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { useSSE } from "@/hooks/useSSE";
import { useSettings } from "@/hooks/useSettings";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { usePermissionRequests } from "@/hooks/usePermissionRequests";
import { useEffect, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { PermissionResponse } from "@/api/types";

export function SessionDetail() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const repoId = parseInt(id || "0");
  const { preferences, updateSettings } = useSettings();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

const { currentPermission, pendingCount, dismissPermission } = usePermissionRequests();
  
  const opcodeUrl = OPENCODE_API_ENDPOINT;
  const openCodeClient = useOpenCodeClient(opcodeUrl, repo?.fullPath);
  
  const repoDirectory = repo?.fullPath;

  const { data: session, isLoading: sessionLoading } = useSession(
    opcodeUrl,
    sessionId,
    repoDirectory,
  );
  const { isConnected, isReconnecting } = useSSE(opcodeUrl, repoDirectory);
  const abortSession = useAbortSession(opcodeUrl, repoDirectory);
  const updateSession = useUpdateSession(opcodeUrl, repoDirectory);
  const { open: openSettings } = useSettingsDialog();

  useKeyboardShortcuts({
    openModelDialog: () => setModelDialogOpen(true),
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const newMode = preferences?.mode === "plan" ? "build" : "plan";
        updateSettings({ mode: newMode });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [preferences?.mode, updateSettings]);

  

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

  const handleScrollToBottom = useCallback(() => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
      setShowScrollButton(false);
    }
  }, []);

  const handlePermissionResponse = useCallback(async (
    permissionID: string, 
    permissionSessionID: string, 
    response: PermissionResponse
  ) => {
    if (!openCodeClient) return
    await openCodeClient.respondToPermission(permissionSessionID, permissionID, response)
  }, [openCodeClient]);

  if (repoLoading || sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!repo || !sessionId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background text-muted-foreground">
        Session not found
      </div>
    );
  }
  
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-background text-muted-foreground">
        Session not found
      </div>
    );
  }
  
  
  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <SessionDetailHeader
        repo={repo}
        sessionId={sessionId}
        sessionTitle={session.title || "Untitled Session"}
        repoId={repoId}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        opcodeUrl={opcodeUrl}
        repoDirectory={repoDirectory}
        onFileBrowserOpen={() => setFileBrowserOpen(true)}
        onSettingsOpen={openSettings}
        onSessionTitleUpdate={handleSessionTitleUpdate}
      />

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div key={sessionId} ref={messageContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-28 overscroll-contain">
          {opcodeUrl && repoDirectory && (
            <MessageThread 
              opcodeUrl={opcodeUrl} 
              sessionID={sessionId} 
              directory={repoDirectory}
              onFileClick={handleFileClick}
              containerRef={messageContainerRef}
              onScrollStateChange={setShowScrollButton}
            />
          )}
        </div>
        {opcodeUrl && repoDirectory && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <PromptInput
              opcodeUrl={opcodeUrl}
              directory={repoDirectory}
              sessionID={sessionId}
              disabled={!isConnected}
              showScrollButton={showScrollButton}
              onScrollToBottom={handleScrollToBottom}
              onShowModelsDialog={() => setModelDialogOpen(true)}
              onShowSessionsDialog={() => setSessionsDialogOpen(true)}
              onShowHelpDialog={() => {
                openSettings()
              }}
            />
          </div>
        )}
      </div>

      <ModelSelectDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        opcodeUrl={opcodeUrl}
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
                  // Navigate to the correct repo session URL pattern
                  const currentPath = window.location.pathname
                  const repoMatch = currentPath.match(/\/repos\/(\d+)\/sessions\//)
                  if (repoMatch) {
                    const repoId = repoMatch[1]
                    navigate(`/repos/${repoId}/sessions/${sessionID}`)
                  } else {
                    // Fallback for direct session access
                    navigate(`/session/${sessionID}`)
                  }
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

      <PermissionRequestDialog
        permission={currentPermission}
        pendingCount={pendingCount}
        onRespond={handlePermissionResponse}
        onDismiss={dismissPermission}
      />
    </div>
  );
}
