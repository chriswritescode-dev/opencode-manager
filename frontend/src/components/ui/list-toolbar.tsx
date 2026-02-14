import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search, GripVertical, Check, Pencil, PencilOff } from "lucide-react";

interface ListToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onDelete: () => void;
  onDeleteAll: () => void;
  reorderMode?: boolean;
  onToggleReorderMode?: () => void;
  showReorderToggle?: boolean;
  manageMode?: boolean;
  onToggleManageMode?: () => void;
}

export function ListToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search",
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onDelete,
  onDeleteAll,
  reorderMode = false,
  onToggleReorderMode,
  showReorderToggle = false,
  manageMode = false,
  onToggleManageMode,
}: ListToolbarProps) {
  const hasItems = totalCount > 0;
  const hasSelection = selectedCount > 0;

  const handleMobileDelete = () => {
    if (hasSelection) {
      onDelete();
    } else {
      onDeleteAll();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      {manageMode && hasItems && (
        <Button
          onClick={onToggleSelectAll}
          variant={hasSelection ? "default" : "outline"}
          className="whitespace-nowrap hidden md:flex"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </Button>
      )}
      {manageMode && (
        <Button
          onClick={onDelete}
          variant="destructive"
          disabled={!hasSelection}
          className="hidden md:flex whitespace-nowrap"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete ({selectedCount})
        </Button>
      )}
      {manageMode && (
        <Button
          onClick={handleMobileDelete}
          variant="destructive"
          size="icon"
          className="md:hidden shrink-0 size-10"
          disabled={!hasItems}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
      {showReorderToggle && onToggleReorderMode && (
        <Button
          onClick={onToggleReorderMode}
          variant={reorderMode ? "default" : "outline"}
          size="icon"
          className="md:hidden shrink-0 size-10"
        >
          {reorderMode ? (
            <Check className="w-4 h-4" />
          ) : (
            <GripVertical className="w-4 h-4" />
          )}
        </Button>
      )}
      {onToggleManageMode && hasItems && (
        <Button
          onClick={onToggleManageMode}
          variant="outline"
          size="icon"
          className="shrink-0 size-10"
        >
          {manageMode ? (
            <PencilOff className="w-4 h-4" />
          ) : (
            <Pencil className="w-4 h-4" />
          )}
        </Button>
      )}
    </div>
  );
}
