import { Settings, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useTheme } from "@/hooks/useTheme";
import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  backTo?: string;
  action?: ReactNode;
  pendingPermissions?: number;
  onPendingPermissionsClick?: () => void;
}

export function Header({ title, backTo, action, pendingPermissions, onPendingPermissionsClick }: HeaderProps) {
  const { open: openSettings } = useSettingsDialog();
  const theme = useTheme();

  return (
    <header className="sticky top-0 z-10 bg-gradient-to-b from-background via-background to-background border-b border-border backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            {backTo && <BackButton to={backTo} />}
            <div className="flex items-center gap-2">
              {title === "OpenCode" ? (
                <img 
                  src={theme === 'light' ? "/opencode-wordmark-light.svg" : "/opencode-wordmark-dark.svg"} 
                  alt="OpenCode" 
                  className="h-6 w-auto sm:h-8"
                />
              ) : (
                <h1 className="text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate">
                  {title}
                </h1>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {action && <div>{action}</div>}
            {pendingPermissions !== undefined && pendingPermissions > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPendingPermissionsClick}
                className="text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 relative"
                title={`${pendingPermissions} pending permission${pendingPermissions > 1 ? 's' : ''}`}
              >
                <Bell className="w-10 h-10" />
                {pendingPermissions > 0 && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {pendingPermissions > 9 ? '9+' : pendingPermissions}
                  </span>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={openSettings}
              className="text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
            >
              <Settings className="w-10 h-10" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
