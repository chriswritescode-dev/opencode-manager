import { Settings, Bell, HelpCircle, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { PageHeader } from "@/components/ui/page-header";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useTheme } from "@/hooks/useTheme";
import { EditSessionTitleDialog } from "@/components/session/EditSessionTitleDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { useMobile } from "@/hooks/useMobile";
import { Loader2, X } from "lucide-react";
import { usePermissions, useQuestions } from "@/contexts/EventContext";

interface HeaderProps {
  children: ReactNode;
  className?: string;
}

function HeaderBase({ children, className, ...props }: HeaderProps) {
  return (
    <PageHeader className={cn("flex-shrink-0", className)} {...props}>
      <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2">
        {children}
      </div>
    </PageHeader>
  );
}

function HeaderBackButton({ to, className }: { to?: string; className?: string }) {
  return to ? <BackButton to={to} className={className} /> : null;
}

interface HeaderTitleProps {
  children: ReactNode;
  logo?: boolean;
  className?: string;
}

function HeaderTitle({ children, logo, className }: HeaderTitleProps) {
  const theme = useTheme();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {logo && typeof children === "string" && children === "OpenCode" ? (
        <img 
          src={theme === 'light' ? "/opencode-wordmark-light.svg" : "/opencode-wordmark-dark.svg"} 
          alt="OpenCode" 
          className="h-6 w-auto sm:h-8"
        />
      ) : (
        <h1 className="text-xl font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate">
          {children}
        </h1>
      )}
    </div>
  );
}

interface HeaderEditableTitleProps {
  value: string;
  onChange: (value: string) => void;
  subtitle?: React.ReactNode;
  generating?: boolean;
  className?: string;
}

function HeaderEditableTitle({ value, onChange, subtitle, generating, className }: HeaderEditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(value);
  const isMobile = useMobile();

  useEffect(() => {
    if (!isEditing) {
      setEditTitle(value);
    }
  }, [value, isEditing]);

  const handleTitleClick = () => {
    setIsEditing(true);
    setEditTitle(value);
  };

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitle.trim() && editTitle !== value) {
      onChange(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditTitle(value);
      setIsEditing(false);
    } else if (e.key === 'Enter') {
      handleTitleSubmit(e);
    }
  };

  const handleSave = (newTitle: string) => {
    if (newTitle.trim() && newTitle !== value) {
      onChange(newTitle.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className={cn("min-w-0 flex-1", className)}>
      {isMobile && (
        <EditSessionTitleDialog
          isOpen={isEditing}
          currentTitle={value}
          onClose={() => setIsEditing(false)}
          onSave={handleSave}
        />
      )}
      {isEditing && !isMobile ? (
        <form onSubmit={handleTitleSubmit} className="flex items-center gap-1 min-w-0">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={(e) => {
              if (!e.relatedTarget?.closest('button')) {
                handleTitleSubmit(e);
              }
            }}
            onKeyDown={handleKeyDown}
            className="text-[16px] sm:text-base font-semibold bg-background border border-border rounded-l px-2 py-1 outline-none w-full truncate focus:border-primary sm:max-w-[250px] h-7"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-l-none border border-l-0 border-border hover:bg-accent flex-shrink-0 mt-0"
            onClick={() => setEditTitle("")}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </form>
      ) : (
        <div className="min-w-0">
          {generating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-xs sm:text-base text-muted-foreground italic">Generating title...</span>
            </div>
          ) : (
            <h1 
              className="text-xs sm:text-base font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent truncate cursor-pointer hover:opacity-80 transition-opacity"
              onClick={handleTitleClick}
            >
              {value}
            </h1>
          )}
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {typeof subtitle === 'string' ? subtitle : subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2", className)}>{children}</div>;
}

function HeaderMobileDropdown({ children, className }: { children: ReactNode; className?: string }) {
  const isMobile = useMobile();
  const { pendingCount: permissionCount, setShowDialog } = usePermissions();
  const { pendingCount: questionCount, navigateToCurrent } = useQuestions();
  const { open } = useSettingsDialog();

  const totalPending = permissionCount + questionCount;

  if (!isMobile) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn("text-foreground border-border hover:bg-accent transition-all duration-200 h-8 w-8 relative", className)}
          title={totalPending > 0 ? `${totalPending} pending notification${totalPending > 1 ? 's' : ''}` : "Options"}
        >
          {totalPending > 0 ? (
            <>
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            </>
          ) : (
            <MoreVertical className="w-4 h-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {permissionCount > 0 && (
          <DropdownMenuItem onClick={() => setShowDialog(true)} className="gap-2">
            <Bell className="w-4 h-4 text-orange-500" />
            <span>{permissionCount} pending permission{permissionCount > 1 ? 's' : ''}</span>
          </DropdownMenuItem>
        )}
        {questionCount > 0 && (
          <DropdownMenuItem onClick={navigateToCurrent} className="gap-2">
            <HelpCircle className="w-4 h-4 text-blue-500" />
            <span>{questionCount} pending question{questionCount > 1 ? 's' : ''}</span>
          </DropdownMenuItem>
        )}
        {totalPending > 0 && children && <DropdownMenuSeparator />}
        {children}
        {children && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={open} className="gap-2">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderSettingsButton() {
  const { open } = useSettingsDialog();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={open}
      className="text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
    >
      <Settings className="w-4 h-4" />
    </Button>
  );
}

export const Header = Object.assign(HeaderBase, {
  BackButton: HeaderBackButton,
  Title: HeaderTitle,
  EditableTitle: HeaderEditableTitle,
  Actions: HeaderActions,
  MobileDropdown: HeaderMobileDropdown,
  Settings: HeaderSettingsButton,
}) as typeof HeaderBase & {
  BackButton: typeof HeaderBackButton;
  Title: typeof HeaderTitle;
  EditableTitle: typeof HeaderEditableTitle;
  Actions: typeof HeaderActions;
  MobileDropdown: typeof HeaderMobileDropdown;
  Settings: typeof HeaderSettingsButton;
};