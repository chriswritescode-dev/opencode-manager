import { useState } from "react";
import { Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepoSearchInput } from "./RepoSearchInput";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
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
  onAddRepo: () => void;
}

const FILTER_OPTIONS: { value: RepoFilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "recent", label: "Recent" },
  { value: "attention", label: "Changes" },
  { value: "worktrees", label: "Worktrees" },
  { value: "local", label: "Local" },
];

const SORT_OPTIONS: { value: RepoSortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "manual", label: "Manual" },
  { value: "name", label: "Name" },
];

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
  onAddRepo,
}: RepoListControlsProps) {
  const isMobile = useMobile();
  const [showMenu, setShowMenu] = useState(false);

  const currentSortLabel =
    SORT_OPTIONS.find((s) => s.value === sortMode)?.label ?? "Recent";
  const activeFilterLabel =
    FILTER_OPTIONS.find((option) => option.value === filterMode)?.label ?? "All";
  const showActiveFilter = isMobile && filterMode !== "recent";
  const inSelectionMode = selectionMode || selectedCount > 0;

  const getDeleteLabel = () => {
    if (hasLocalRepos && !hasClonedRepos) {
      return "Unlink";
    }
    return "Delete";
  };

  if (inSelectionMode) {
    return (
      <div className="px-2 md:px-0">
        <div className="flex items-center gap-1.5 bg-accent/50 rounded-md p-2">
          <span className="text-sm font-medium text-foreground shrink-0">
            {selectedCount} selected
          </span>
          <Button
            variant="ghost"
            onClick={onSelectAll}
            className="shrink-0 h-8 px-2 text-xs"
            size="sm"
          >
            {allVisibleSelected ? "Unselect All" : "Select All"}
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={selectedCount === 0}
            className="shrink-0 h-8 px-2 text-xs text-destructive hover:text-destructive"
            size="sm"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {getDeleteLabel()}
          </Button>
          <Button
            variant="ghost"
            onClick={onClearSelection}
            aria-label="Done selecting repositories"
            className="shrink-0 h-8 px-2 text-xs gap-1 ml-auto"
            size="sm"
          >
            <X className="w-3.5 h-3.5" />
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 md:px-0 space-y-2">
      <div className="flex items-center gap-2">
        <RepoSearchInput value={searchQuery} onValueChange={onSearchChange} />

        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Add repository"
            title="Add repository"
            className="h-9 w-9 shrink-0"
            onClick={onAddRepo}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}

        {isMobile ? (
          <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Filter and sort repositories"
                title="Filter and sort repositories"
                className="h-9 w-9 shrink-0"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuCheckboxItem
                checked={selectionMode}
                onCheckedChange={(checked) =>
                  onSelectionModeChange(checked === true)
                }
              >
                Select repositories
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
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
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
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

      {showActiveFilter && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onFilterModeChange("recent")}
            aria-label={`Clear filter: ${activeFilterLabel}`}
            className="h-7 gap-1 rounded-full px-2.5 text-xs"
          >
            {activeFilterLabel}
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

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
            {filteredCount} {filteredCount === 1 ? "repo" : "repos"}
            {searchQuery && ` matching "${searchQuery}"`}
          </span>
          {attentionCount > 0 && filterMode !== "attention" && (
            <span>
              {attentionCount}{" "}
              {attentionCount === 1 ? "needs attention" : "need attention"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

