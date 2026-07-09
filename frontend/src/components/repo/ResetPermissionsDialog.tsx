import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
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
}

export function ResetPermissionsDialog({
  open,
  onOpenChange,
  repoId,
}: ResetPermissionsDialogProps) {
  const { t } = useTranslation();
  const resetPermissionsMutation = useMutation({
    mutationFn: () => resetRepoPermissions(repoId),
    onSuccess: () => {
      showToast.success(t("repo.resetPermissions") + " " + t("common.success"));
      onOpenChange(false);
    },
    onError: () => {
      showToast.error(t("repo.resetPermissions") + " " + t("common.failed"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("repo.resetPermissions")}</DialogTitle>
          <DialogDescription>
            {t("settings.permissions")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={resetPermissionsMutation.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => resetPermissionsMutation.mutate()}
            disabled={resetPermissionsMutation.isPending}
          >
            {resetPermissionsMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("common.pending")}
              </>
            ) : (
              t("repo.resetPermissions")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
