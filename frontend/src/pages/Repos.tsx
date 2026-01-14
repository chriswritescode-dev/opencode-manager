import { useState } from "react";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Bell, BellOff, BellRing } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";

function NotificationButton() {
  const { isSupported, permission, isEnabled, requestPermission } = useNotifications();
  const [isRequesting, setIsRequesting] = useState(false);

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    setIsRequesting(true);
    try {
      await requestPermission();
    } finally {
      setIsRequesting(false);
    }
  };

  if (permission === 'granted' && isEnabled) {
    return (
      <Button variant="ghost" size="icon" disabled title="Notifications enabled">
        <BellRing className="w-4 h-4 text-green-500" />
      </Button>
    );
  }

  if (permission === 'denied') {
    return (
      <Button variant="ghost" size="icon" disabled title="Notifications blocked - enable in browser settings">
        <BellOff className="w-4 h-4 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      disabled={isRequesting}
      title="Enable notifications for all sessions"
    >
      <Bell className="w-4 h-4 sm:mr-2" />
      <span className="hidden sm:inline">
        {isRequesting ? "Enabling..." : "Notifications"}
      </span>
    </Button>
  );
}

export function Repos() {
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <Header
        title="OpenCode"
        action={
          <div className="flex items-center gap-2">
            <NotificationButton />
            <Button
              variant="outline"
              onClick={() => setFileBrowserOpen(true)}
            >
              <FolderOpen className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Workspace</span>
            </Button>
            <Button
              onClick={() => setAddRepoOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Repository</span>
              <span className="sm:hidden">Repo</span>
            </Button>
          </div>
        }
      />
      <div className="container mx-auto sm:p-2 p-4">
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
