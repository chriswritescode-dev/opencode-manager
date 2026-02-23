import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetRepoPermissions } from "@/api/repos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { showToast } from "@/lib/toast";

interface ResetPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: number;
  repoDirectory?: string;
}

export function ResetPermissionsDialog({
  open,
  onOpenChange,
  repoId,
  repoDirectory,
}: ResetPermissionsDialogProps) {
  const queryClient = useQueryClient();

  const resetPermissionsMutation = useMutation({
    mutationFn: () => resetRepoPermissions(repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["opencode", "sessions", "http://localhost:5551", repoDirectory],
      });
      showToast.success("Permissions reset successfully");
      onOpenChange(false);
    },
    onError: () => {
      showToast.error("Failed to reset permissions");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Permissions</DialogTitle>
          <DialogDescription>
            This will clear all "Allow Always" permissions for this repository.
            You will be prompted again for permission when opencode needs to perform
            actions like running commands or editing files.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={resetPermissionsMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => resetPermissionsMutation.mutate()}
            disabled={resetPermissionsMutation.isPending}
          >
            {resetPermissionsMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Resetting...
              </>
            ) : (
              "Reset Permissions"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
