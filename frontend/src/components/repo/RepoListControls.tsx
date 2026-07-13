import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useMobile } from "@/hooks/useMobile";
import type { RepoFilterMode, RepoSortMode } from "./repo-list-state";

interface RepoListControlsProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterMode: RepoFilterMode;
  onFilterModeChange: (mode: RepoFilterMode) => void;
  sortMode: RepoSortMode;
  onSortModeChange: (mode: RepoSortMode) => void;
  filteredCount: number;
  attentionCount: number;
  selectedCount: number;
  allVisibleSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  hasLocalRepos: boolean;
  hasClonedRepos: boolean;
  selectionMode: boolean;
  onSelectionModeChange: (enabled: boolean) => void;
}

export function RepoListControls({
  searchQuery,
  onSearchChange,
  filterMode,
  onFilterModeChange,
  sortMode,
  onSortModeChange,
  filteredCount,
  attentionCount,
  selectedCount,
  allVisibleSelected,
  onSelectAll,
  onClearSelection,
  onDelete,
  hasLocalRepos,
  hasClonedRepos,
  selectionMode,
  onSelectionModeChange,
}: RepoListControlsProps) {
  const { t } = useTranslation();
  const isMobile = useMobile();
  const [showMenu, setShowMenu] = useState(false);

  const FILTER_OPTIONS: { value: RepoFilterMode; label: string }[] = [
    { value: "all", label: t("repo.allFilter") },
    { value: "recent", label: t("repo.recent") },
    { value: "attention", label: t("repo.changes") },
    { value: "worktrees", label: t("repo.worktrees") },
    { value: "local", label: t("repo.localFilter") },
  ];

  const SORT_OPTIONS: { value: RepoSortMode; label: string }[] = [
    { value: "recent", label: t("repo.recent") },
    { value: "manual", label: t("repo.manualSort") },
    { value: "name", label: t("repo.nameSort") },
  ];

  const currentSortLabel =
    SORT_OPTIONS.find((s) => s.value === sortMode)?.label ?? t("repo.recent");
  const inSelectionMode = selectedCount > 0;

  const getDeleteLabel = () => {
    if (hasLocalRepos && !hasClonedRepos) {
      return t("repo.unlink");
    }
    return t("repo.delete");
  };

  if (inSelectionMode) {
    return (
      <div className="px-2 md:px-0">
        <div className="flex items-center gap-2 bg-accent/50 rounded-md p-2">
          <span className="text-sm font-medium text-foreground shrink-0 min-w-[80px]">
            {selectedCount} {t("common.selected")}
          </span>
          <Button
            variant="ghost"
            onClick={onSelectAll}
            className="shrink-0 h-9 text-xs"
            size="sm"
          >
            {allVisibleSelected ? t("repo.unselectAll") : t("repo.selectAll")}
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            className="shrink-0 h-9 text-xs text-destructive hover:text-destructive"
            size="sm"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {getDeleteLabel()}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            className="shrink-0 size-9 ml-auto text-destructive hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 md:px-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("repo.searchReposPlaceholder")}
            className="pl-9 h-9"
            autoComplete="off"
            name="repo-search"
          />
        </div>

        {isMobile ? (
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuCheckboxItem
                checked={selectionMode}
                onCheckedChange={(checked) =>
                  onSelectionModeChange(checked === true)
                }
              >
                {t("session.selectRepositories")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {FILTER_OPTIONS.map((option) => {
                const count =
                  option.value === "attention"
                    ? attentionCount
                    : option.value === "all"
                      ? filteredCount
                      : undefined;

                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => {
                      onFilterModeChange(option.value);
                      setShowMenu(false);
                    }}
                    className={filterMode === option.value ? "bg-accent" : ""}
                  >
                    {option.label}
                    {count !== undefined && count > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {count}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">{currentSortLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    onSortModeChange(option.value);
                    setShowMenu(false);
                  }}
                  className={sortMode === option.value ? "bg-accent" : ""}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!isMobile && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          {FILTER_OPTIONS.map((option) => {
            const count =
              option.value === "attention"
                ? attentionCount
                : option.value === "all"
                  ? filteredCount
                  : undefined;

            return (
              <Button
                key={option.value}
                variant={filterMode === option.value ? "default" : "ghost"}
                size="sm"
                onClick={() => onFilterModeChange(option.value)}
                className="shrink-0 gap-1.5"
              >
                {option.label}
                {count !== undefined && count > 0 && (
                  <span
                    className={`text-xs ${filterMode === option.value ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                  >
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {!isMobile && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {filteredCount} {filteredCount === 1 ? t("repo.repo") : t("repo.repos")}
            {searchQuery && ` ${t("repo.matching")} "${searchQuery}"`}
          </span>
          {attentionCount > 0 && filterMode !== "attention" && (
            <span>
              {attentionCount}{" "}
              {attentionCount === 1 ? t("repo.needsAttention") : t("repo.needAttention")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
