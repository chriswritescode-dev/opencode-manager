import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface RepoSearchInputProps {
  value: string;
  onValueChange: (query: string) => void;
  placeholder?: string;
  name?: string;
}

export function RepoSearchInput({
  value,
  onValueChange,
  placeholder = "Search repositories...",
  name = "repo-search",
}: RepoSearchInputProps) {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9 h-9"
        autoComplete="off"
        name={name}
      />
    </div>
  );
}
