import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, CalendarClock } from "lucide-react";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";

export function Repos() {
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Header.Title logo>OpenCode</Header.Title>
        </div>
        <Header.Actions>
          <PendingActionsGroup />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFileBrowserOpen(true)}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/schedules')}
            size="sm"
            className="hidden sm:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            All Schedules
          </Button>
          <Button onClick={() => setAddRepoOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Repo
          </Button>
          <span className="hidden sm:block">
            <Header.Settings />
          </span>
          <Header.MobileDropdown hideSettings />
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 pt-2 px-2 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+64px)] sm:pb-0">

        <RepoList />
      </div>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={handleCloseFileBrowser}
        basePath=""
        repoName="Workspace Root"
      />
    </div>
  );
}
