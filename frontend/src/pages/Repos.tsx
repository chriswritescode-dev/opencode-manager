import { useState } from "react";
import { RepoList } from "@/components/repo/RepoList";
import { usePermissionContext } from "@/contexts/PermissionContext";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen } from "lucide-react";

export function Repos() {
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const { pendingCount, setShowDialog } = usePermissionContext();

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <Header
        title="OpenCode"
        pendingPermissions={pendingCount}
        onPendingPermissionsClick={() => setShowDialog(true)}
        action={
          <div className="flex items-center gap-2">
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
