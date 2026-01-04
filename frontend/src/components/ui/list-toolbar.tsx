import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search } from "lucide-react";

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
    <div className="flex items-center gap-3">
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
      {hasItems && (
        <Button
          onClick={onToggleSelectAll}
          variant={hasSelection ? "default" : "outline"}
          className="whitespace-nowrap hidden md:flex"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </Button>
      )}
      <Button
        onClick={onDelete}
        variant="destructive"
        disabled={!hasSelection}
        className="hidden md:flex whitespace-nowrap"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete ({selectedCount})
      </Button>
      <Button
        onClick={handleMobileDelete}
        variant="destructive"
        size="icon"
        className="md:hidden"
        disabled={!hasItems}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
