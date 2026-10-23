import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FolderOpen, CalendarClock } from "lucide-react";
import { LOCAL_OPENCODE_SERVER_ID } from "@opencode-manager/shared/schemas";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { RemoteProjectList } from "@/components/servers/RemoteProjectList";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { LinkedServersNav } from "@/components/navigation/LinkedServersNav";
import { ToolSidePanel } from "@/components/navigation/ToolSidePanel";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useMobile } from "@/hooks/useMobile";
import { useSidebarServerSelection } from "@/hooks/useSidebarServerSelection";
import { useToolPanel } from "@/hooks/useToolPanel";

export function Repos() {
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const docked = !useMobile();
  const toolPanel = useToolPanel(docked);
  const [selectedServerId] = useSidebarServerSelection();
  const isLocalServer = selectedServerId === LOCAL_OPENCODE_SERVER_ID;

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  return (
    <div className="flex h-full max-h-full min-w-0">
    <div className="flex-1 min-w-0 h-full max-h-full overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Header.Title logo>OpenCode</Header.Title>
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          {isLocalServer && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFileBrowserOpen(true)}
              aria-label="Open files"
              className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
          )}
          <LinkedServersNav variant="header" />
          <Button
            variant="outline"
            onClick={() => navigate('/schedules')}
            size="sm"
            className="hidden sm:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            All Schedules
          </Button>
          {isLocalServer ? (
            <Button
              onClick={() => setAddRepoOpen(true)}
              size="sm"
              className="hidden md:inline-flex"
            >
              <Plus className="w-4 h-4 mr-1" />
              Repo
            </Button>
          ) : null}
          <span>
            <Header.Settings />
          </span>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 pt-2 px-2 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-0">
        {isLocalServer ? <RepoList onAddRepo={() => setAddRepoOpen(true)} /> : <RemoteProjectList serverId={selectedServerId} />}
      </div>
      {isLocalServer ? (
        <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
      ) : null}
      {isLocalServer ? (
        <FileBrowserSheet
          isOpen={!docked && fileBrowserOpen}
          onClose={handleCloseFileBrowser}
          basePath=""
          repoName="Workspace Root"
          allowNavigateAboveBase={true}
        />
      ) : null}
    </div>
      {isLocalServer && docked ? <ToolSidePanel panel={toolPanel} filesBasePath="" allowNavigateAboveBase /> : null}
    </div>
  );
}
