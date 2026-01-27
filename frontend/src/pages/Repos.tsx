import { useState } from "react";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Bell, BellOff, BellRing, Clock, Command } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { RecentSessions } from "@/components/session/RecentSessions";
import { useSessionSwitcherStore } from "@/stores/sessionSwitcherStore";
import { subscribePushNotifications, isPushSubscribed } from "@/api/push";
import { showToast } from "@/lib/toast";
import { useEffect } from "react";

function NotificationButton() {
  const { isSupported, permission, isEnabled, requestPermission } = useNotifications();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(false);

  useEffect(() => {
    isPushSubscribed().then(setIsPushEnabled);
  }, []);

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestPermission();
      if (granted) {
        const subscription = await subscribePushNotifications();
        if (subscription) {
          setIsPushEnabled(true);
          showToast.success("Background notifications enabled! You'll receive alerts even when the app is closed.");
        } else {
          showToast.error("Failed to enable background notifications");
        }
      }
    } finally {
      setIsRequesting(false);
    }
  };

  if ((permission === 'granted' && isEnabled) || isPushEnabled) {
    return (
      <Button variant="ghost" size="icon" disabled title="Background notifications enabled">
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
  const openSwitcher = useSessionSwitcherStore((state) => state.open);

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <Header
        title="OpenCode"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={openSwitcher}
              title="Quick switch (Cmd/Ctrl+K)"
              className="hidden sm:flex"
            >
              <Command className="w-4 h-4" />
            </Button>
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
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground">Recent Sessions (Last 8 hours)</h2>
          </div>
          <RecentSessions maxItems={5} />
        </div>
        <div className="mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">Repositories</h2>
        </div>
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
