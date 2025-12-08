import { useState, useEffect, useMemo, useCallback, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Check, Star, Home, Globe } from "lucide-react";
import {
  getProvidersWithModels,
  formatModelName,
  formatProviderName,
} from "@/api/providers";
import { useModelSelection } from "@/hooks/useModelSelection";
import { useQuery } from "@tanstack/react-query";
import type { Model, ProviderWithModels } from "@/api/providers";

interface ModelSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opcodeUrl?: string | null;
  directory?: string;
}

interface FlatModel {
  model: Model;
  provider: ProviderWithModels;
  modelKey: string;
}

interface SearchInputProps {
  onSearch: (query: string) => void;
  initialValue?: string;
}

function SearchInput({ onSearch, initialValue = "" }: SearchInputProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), 150);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className="p-3 sm:p-4 border-b border-border flex-shrink-0">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search models..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-10 text-sm"
        />
      </div>
    </div>
  );
}

interface ModelCardProps {
  model: Model;
  provider: ProviderWithModels;
  modelKey: string;
  isSelected: boolean;
  onSelect: (providerId: string, modelId: string) => void;
}

const ModelCard = memo(function ModelCard({ 
  model, 
  provider, 
  isSelected, 
  onSelect 
}: ModelCardProps) {
  const capabilities = useMemo(() => {
    const caps = [];
    if (model.reasoning) caps.push("Reasoning");
    if (model.tool_call) caps.push("Tools");
    if (model.attachment) caps.push("Files");
    return caps;
  }, [model.reasoning, model.tool_call, model.attachment]);

  const statusBadge = useMemo(() => {
    if (model.experimental) return <Badge variant="secondary">Experimental</Badge>;
    if (model.status === "alpha") return <Badge variant="destructive">Alpha</Badge>;
    if (model.status === "beta") return <Badge variant="secondary">Beta</Badge>;
    return null;
  }, [model.experimental, model.status]);

  const sourceBadge = useMemo(() => {
    switch (provider.source) {
      case "configured":
        return <Badge variant="default" className="text-xs px-1.5 py-0 bg-yellow-500/20 text-yellow-600 border-yellow-500/30">Custom</Badge>;
      case "local":
        return <Badge variant="default" className="text-xs px-1.5 py-0 bg-green-500/20 text-green-600 border-green-500/30">Local</Badge>;
      default:
        return null;
    }
  }, [provider.source]);

  return (
    <div
      className={`p-3 sm:p-4 rounded-lg border cursor-pointer transition-colors ${
        isSelected
          ? "bg-blue-600/20 border-blue-500"
          : "bg-card border-border hover:bg-accent"
      }`}
      onClick={() => onSelect(provider.id, model.id)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <h4 className="font-semibold text-sm truncate">
              {formatModelName(model)}
            </h4>
            {sourceBadge}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {formatProviderName(provider)}
          </p>
        </div>
        {isSelected && (
          <Check className="h-4 w-4 text-blue-500 flex-shrink-0 ml-2" />
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-2 sm:mb-3 font-mono truncate">
        {model.id}
      </div>

      {capabilities.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2 sm:mb-3">
          {capabilities.slice(0, 2).map((cap) => (
            <Badge key={cap} variant="secondary" className="text-xs px-1.5 py-0.5">
              {cap}
            </Badge>
          ))}
          {capabilities.length > 2 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
              +{capabilities.length - 2}
            </Badge>
          )}
        </div>
      )}

      {statusBadge && <div className="mb-2 sm:mb-3">{statusBadge}</div>}

      <div className="text-xs text-muted-foreground space-y-1">
        {model.limit?.context && (
          <div className="flex justify-between">
            <span>Context:</span>
            <span className="ml-1">
              {model.limit.context >= 1000000
                ? `${(model.limit.context / 1000000).toFixed(1)}M`
                : model.limit.context.toLocaleString()
              } tokens
            </span>
          </div>
        )}
        {model.cost && (
          <div className="flex justify-between">
            <span>Cost:</span>
            <span className="ml-1">${model.cost.input.toFixed(4)}/1K</span>
          </div>
        )}
      </div>
    </div>
  );
});

interface ModelGridProps {
  models: FlatModel[];
  currentModel: string;
  onSelect: (providerId: string, modelId: string) => void;
  loading: boolean;
  recentModels?: FlatModel[];
  showRecent?: boolean;
}

const ModelGrid = memo(function ModelGrid({ 
  models, 
  currentModel, 
  onSelect, 
  loading,
  recentModels = [],
  showRecent = false,
}: ModelGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (models.length === 0 && recentModels.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No models found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showRecent && recentModels.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5" />
            Recent Models
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {recentModels.map(({ model, provider, modelKey }) => (
              <ModelCard
                key={`recent-${modelKey}`}
                model={model}
                provider={provider}
                modelKey={modelKey}
                isSelected={currentModel === modelKey}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}

      {models.length > 0 && (
        <div>
          {showRecent && recentModels.length > 0 && (
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">
              All Models
            </h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {models.map(({ model, provider, modelKey }) => (
              <ModelCard
                key={modelKey}
                model={model}
                provider={provider}
                modelKey={modelKey}
                isSelected={currentModel === modelKey}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

interface ProviderSidebarProps {
  groupedProviders: {
    configured: ProviderWithModels[];
    local: ProviderWithModels[];
    builtin: ProviderWithModels[];
  };
  selectedProvider: string;
  onSelect: (providerId: string) => void;
}

const ProviderSidebar = memo(function ProviderSidebar({
  groupedProviders,
  selectedProvider,
  onSelect,
}: ProviderSidebarProps) {
  return (
    <div className="hidden sm:block w-48 lg:w-64 border-r border-border bg-muted/20 p-4 overflow-y-auto flex-shrink-0">
      <div className="space-y-4">
        <Button
          variant={!selectedProvider ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onSelect("")}
          className="w-full justify-start text-sm"
        >
          All Providers
        </Button>

        {groupedProviders.configured.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-yellow-600 mb-2 flex items-center gap-1.5">
              <Star className="h-3 w-3" />
              Custom Providers
            </h3>
            <div className="space-y-1">
              {groupedProviders.configured.map((provider) => (
                <Button
                  key={provider.id}
                  variant={selectedProvider === provider.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onSelect(provider.id)}
                  className="w-full justify-start text-sm"
                >
                  {formatProviderName(provider)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {groupedProviders.local.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1.5">
              <Home className="h-3 w-3" />
              Local Providers
            </h3>
            <div className="space-y-1">
              {groupedProviders.local.map((provider) => (
                <Button
                  key={provider.id}
                  variant={selectedProvider === provider.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onSelect(provider.id)}
                  className="w-full justify-start text-sm"
                >
                  {formatProviderName(provider)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {groupedProviders.builtin.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              Built-in Providers
            </h3>
            <div className="space-y-1">
              {groupedProviders.builtin.map((provider) => (
                <Button
                  key={provider.id}
                  variant={selectedProvider === provider.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onSelect(provider.id)}
                  className="w-full justify-start text-sm"
                >
                  {formatProviderName(provider)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export function ModelSelectDialog({
  open,
  onOpenChange,
  opcodeUrl,
  directory,
}: ModelSelectDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");

  const { modelString, setModel, recentModels } = useModelSelection(opcodeUrl, directory);
  const currentModel = modelString || "";

  const { data: providers = [], isLoading: loading } = useQuery({
    queryKey: ["providers-with-models"],
    queryFn: () => getProvidersWithModels(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (open) {
      setSelectedProvider("");
    }
  }, [open]);

  const flatModels = useMemo((): FlatModel[] => {
    const sourceOrder = { configured: 0, local: 1, builtin: 2 };
    return providers
      .slice()
      .sort((a, b) => (sourceOrder[a.source] ?? 2) - (sourceOrder[b.source] ?? 2))
      .flatMap((provider) =>
        provider.models.map((model) => ({
          model,
          provider,
          modelKey: `${provider.id}/${model.id}`,
        }))
      );
  }, [providers]);

  const recentFlatModels = useMemo((): FlatModel[] => {
    return recentModels
      .map((recent) => {
        const modelKey = `${recent.providerID}/${recent.modelID}`;
        return flatModels.find((fm) => fm.modelKey === modelKey);
      })
      .filter((fm): fm is FlatModel => fm !== undefined)
      .slice(0, 6);
  }, [recentModels, flatModels]);

  const filteredModels = useMemo(() => {
    const search = searchQuery.toLowerCase();
    return flatModels.filter((item) => {
      if (selectedProvider && item.provider.id !== selectedProvider) {
        return false;
      }
      if (!search) return true;
      return (
        item.model.name.toLowerCase().includes(search) ||
        item.model.id.toLowerCase().includes(search) ||
        item.provider.name.toLowerCase().includes(search)
      );
    });
  }, [flatModels, selectedProvider, searchQuery]);

  const groupedProviders = useMemo(() => {
    const configured = providers.filter(p => p.source === "configured");
    const local = providers.filter(p => p.source === "local");
    const builtin = providers.filter(p => p.source === "builtin");
    return { configured, local, builtin };
  }, [providers]);

  const selectedProviderData = useMemo(
    () => providers.find(p => p.id === selectedProvider),
    [providers, selectedProvider]
  );

  const handleProviderSelect = useCallback((providerId: string) => {
    setSelectedProvider(providerId);
    setSearchQuery("");
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleModelSelect = useCallback((providerId: string, modelId: string) => {
    setModel({ providerID: providerId, modelID: modelId });
    onOpenChange(false);
  }, [setModel, onOpenChange]);

  const searchResetKey = selectedProvider;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[95vw] h-[90vh] max-h-[90vh] bg-background border-border text-foreground p-0 flex flex-col gap-0">
        <DialogHeader className="p-4 sm:p-6 pb-2 border-b border-border flex-shrink-0">
          <DialogTitle className="text-lg sm:text-xl font-semibold">
            {selectedProvider && selectedProviderData ? `Select Model - ${selectedProviderData.name}` : 'Select Model'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          <ProviderSidebar
            groupedProviders={groupedProviders}
            selectedProvider={selectedProvider}
            onSelect={handleProviderSelect}
          />

          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="sm:hidden p-3 border-b border-border flex-shrink-0">
              <Select onValueChange={handleProviderSelect} value={selectedProvider || undefined}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider..." />
                </SelectTrigger>
                <SelectContent>
                  {groupedProviders.configured.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5 text-yellow-600">
                        <Star className="h-3 w-3" />
                        Custom Providers
                      </SelectLabel>
                      {groupedProviders.configured.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {formatProviderName(provider)} ({provider.models.length})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {groupedProviders.local.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5 text-green-600">
                        <Home className="h-3 w-3" />
                        Local Providers
                      </SelectLabel>
                      {groupedProviders.local.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {formatProviderName(provider)} ({provider.models.length})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {groupedProviders.builtin.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5 text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        Built-in Providers
                      </SelectLabel>
                      {groupedProviders.builtin.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {formatProviderName(provider)} ({provider.models.length})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <SearchInput 
              key={searchResetKey} 
              onSearch={handleSearch} 
            />

            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <ModelGrid
                models={filteredModels}
                currentModel={currentModel}
                onSelect={handleModelSelect}
                loading={loading}
                recentModels={recentFlatModels}
                showRecent={!selectedProvider && !searchQuery}
              />
            </div>

            {currentModel && (
              <div className="p-3 sm:p-4 border-t border-border bg-muted/20 flex-shrink-0">
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Current: <span className="font-medium text-foreground break-all">{currentModel}</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
