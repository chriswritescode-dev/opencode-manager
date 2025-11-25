import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput } from "@/components/message/PromptInput";
import { ModelSelectDialog } from "@/components/model/ModelSelectDialog";
import { SessionDetailHeader } from "@/components/session/SessionDetailHeader";
import { SessionList } from "@/components/session/SessionList";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSession, useMessages, useAbortSession } from "@/hooks/useOpenCode";
import { OPENCODE_API_ENDPOINT } from "@/constants/api";
import { useSSE } from "@/hooks/useSSE";
import { useSettings } from "@/hooks/useSettings";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

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
  const lastMessageCountRef = useRef(0);
  const userJustSentMessageRef = useRef(false);
  const hasInitialScrolledRef = useRef(false);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: !!repoId,
  });

  

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const repoDirectory = repo?.fullPath;

  const { data: session, isLoading: sessionLoading } = useSession(
    opcodeUrl,
    sessionId,
    repoDirectory,
  );
  const { data: messages } = useMessages(opcodeUrl, sessionId, repoDirectory);
  const { isConnected } = useSSE(opcodeUrl, repoDirectory);
  const abortSession = useAbortSession(opcodeUrl, repoDirectory);
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

  useEffect(() => {
    if (!messageContainerRef.current) return;

    const container = messageContainerRef.current;
    const currentMessageCount = messages?.length || 0;
    const previousMessageCount = lastMessageCountRef.current;

    if (!hasInitialScrolledRef.current && currentMessageCount > 0) {
      hasInitialScrolledRef.current = true;
      container.scrollTop = container.scrollHeight;
      lastMessageCountRef.current = currentMessageCount;
      return;
    }

    const messageAdded = currentMessageCount > previousMessageCount;
    lastMessageCountRef.current = currentMessageCount;

    const lastMessage = messages?.[messages.length - 1];
    const isUserMessage = lastMessage?.info.role === "user";

    if (messageAdded && isUserMessage) {
      userJustSentMessageRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (!preferences?.autoScroll) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;

    if (userJustSentMessageRef.current || isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }

    if (
      lastMessage?.info.role === "assistant" &&
      "completed" in lastMessage.info.time &&
      lastMessage.info.time.completed
    ) {
      userJustSentMessageRef.current = false;
    }
  }, [messages, preferences?.autoScroll]);

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

  const handleFileClick = (filePath: string) => {
    
    let pathToOpen = filePath
    
    if (filePath.startsWith('/') && repo.fullPath) {
      const workspaceReposPath = repo.fullPath.substring(0, repo.fullPath.lastIndexOf('/'))
      
      if (filePath.startsWith(workspaceReposPath + '/')) {
        pathToOpen = filePath.substring(workspaceReposPath.length + 1)
      }
    }
    
    setSelectedFilePath(pathToOpen)
    setFileBrowserOpen(true)
  };
  
  
  return (
    <div className="h-screen bg-gradient-to-br from-background via-background to-background flex flex-col">
      <SessionDetailHeader
        repo={repo}
        sessionId={sessionId}
        sessionTitle={session.title || "Untitled Session"}
        repoId={repoId}
        isConnected={isConnected}
        opcodeUrl={opcodeUrl}
        repoDirectory={repoDirectory}
        onFileBrowserOpen={() => setFileBrowserOpen(true)}
        onSettingsOpen={openSettings}
      />

      <div className="flex-1 overflow-hidden">
        <div ref={messageContainerRef} className="h-full overflow-y-auto">
          {opcodeUrl && repoDirectory && (
            <MessageThread 
              opcodeUrl={opcodeUrl} 
              sessionID={sessionId} 
              directory={repoDirectory}
              onFileClick={handleFileClick}
            />
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-border bg-gradient-to-t from-background via-background to-background backdrop-blur-sm">
        {opcodeUrl && repoDirectory && (
          <PromptInput
            opcodeUrl={opcodeUrl}
            directory={repoDirectory}
            sessionID={sessionId}
            disabled={!isConnected}
            onShowModelsDialog={() => setModelDialogOpen(true)}
            onShowSessionsDialog={() => setSessionsDialogOpen(true)}
            onShowHelpDialog={() => {
              // For now, just open the settings dialog where help might be available
              openSettings()
            }}
          />
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
        onClose={() => {
          setFileBrowserOpen(false)
          setSelectedFilePath(undefined)
        }}
        basePath={repo.localPath}
        repoName={repo.repoUrl.split("/").pop()?.replace(".git", "") || "Repository"}
        initialSelectedFile={selectedFilePath}
      />
    </div>
  );
}
