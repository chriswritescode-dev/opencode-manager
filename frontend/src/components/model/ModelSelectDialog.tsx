import { useState, useEffect, useMemo } from "react";
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
import { useSettings } from "@/hooks/useSettings";
import { useOpenCodeClient } from "@/hooks/useOpenCode";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Model, ProviderSource } from "@/api/providers";

interface ModelSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opcodeUrl?: string | null;
}

export function ModelSelectDialog({
  open,
  onOpenChange,
  opcodeUrl,
}: ModelSelectDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [viewMode, setViewMode] = useState<'providers' | 'models'>('providers');
  const { preferences, updateSettings } = useSettings();
  const client = useOpenCodeClient(opcodeUrl);
  const { sessionID } = useParams<{ sessionID: string }>();

  const currentModel = preferences?.defaultModel || "";

  const { data: providers = [], isLoading: loading } = useQuery({
    queryKey: ["providers-with-models"],
    queryFn: () => getProvidersWithModels(),
    enabled: open,
  });

  useEffect(() => {
    if (currentModel && providers.length > 0) {
      const [providerId] = currentModel.split("/");
      setSelectedProvider(providerId);
    }
  }, [currentModel, providers]);

  const filteredProviders = providers.filter((provider) => {
    const matchesSearch =
      provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.models.some(
        (model) =>
          model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          model.id.toLowerCase().includes(searchQuery.toLowerCase()),
      );

    const matchesSelectedProvider = !selectedProvider || provider.id === selectedProvider;

    return matchesSearch && matchesSelectedProvider;
  });

  const selectedProviderData = providers.find(p => p.id === selectedProvider);

  const groupedProviders = useMemo(() => {
    const configured = providers.filter(p => p.source === "configured");
    const local = providers.filter(p => p.source === "local");
    const builtin = providers.filter(p => p.source === "builtin");
    return { configured, local, builtin };
  }, [providers]);

  const getSourceBadge = (source: ProviderSource) => {
    switch (source) {
      case "configured":
        return <Badge variant="default" className="text-xs px-1.5 py-0 bg-yellow-500/20 text-yellow-600 border-yellow-500/30">Custom</Badge>;
      case "local":
        return <Badge variant="default" className="text-xs px-1.5 py-0 bg-green-500/20 text-green-600 border-green-500/30">Local</Badge>;
      case "builtin":
        return null;
    }
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId);
    setViewMode('models');
    setSearchQuery("");
  };

  const handleBackToProviders = () => {
    setViewMode('providers');
    setSearchQuery("");
  };

  const handleModelSelect = async (providerId: string, modelId: string) => {
    const newModel = `${providerId}/${modelId}`;

    // Update settings for future sessions
    updateSettings({ defaultModel: newModel });

    // If we're in a session, try to update the current session's model
    if (sessionID && client) {
      try {
        await client.sendCommand(sessionID, {
          command: "model",
          arguments: newModel,
          model: newModel,
        });
      } catch {
        // Ignore errors when updating session model
      }
    }

    onOpenChange(false);
  };

  

  const getStatusBadge = (model: Model) => {
    if (model.experimental)
      return <Badge variant="secondary">Experimental</Badge>;
    if (model.status === "alpha")
      return <Badge variant="destructive">Alpha</Badge>;
    if (model.status === "beta") return <Badge variant="secondary">Beta</Badge>;
    return null;
  };

  const getModelCapabilities = (model: Model) => {
    const capabilities = [];
    if (model.reasoning) capabilities.push("Reasoning");
    if (model.tool_call) capabilities.push("Tools");
    if (model.attachment) capabilities.push("Files");
    return capabilities;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[95vw] h-[90vh] max-h-[90vh] bg-background border-border text-foreground p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 pb-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {viewMode === 'models' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToProviders}
                className="p-1 h-8 w-8"
              >
                ←
              </Button>
            )}
            <DialogTitle className="text-lg sm:text-xl font-semibold">
              {viewMode === 'providers' ? 'Select Model' : `Select Model - ${selectedProviderData?.name || ''}`}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Provider List (Desktop) */}
          <div className="hidden sm:block w-48 lg:w-64 border-r border-border bg-muted/20 p-4 overflow-y-auto">
            <div className="space-y-4">
              <Button
                variant={!selectedProvider ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setSelectedProvider("");
                  handleBackToProviders();
                }}
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
                        onClick={() => handleProviderSelect(provider.id)}
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
                        onClick={() => handleProviderSelect(provider.id)}
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
                        onClick={() => handleProviderSelect(provider.id)}
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

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile Provider Dropdown */}
            <div className="sm:hidden p-3 border-b border-border">
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

            {/* Search Bar */}
            <div className="p-3 sm:p-4 border-b border-border">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={selectedProvider ? "Search models..." : "Search models..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 text-sm"
                />
              </div>
            </div>

            {/* Models Grid */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  No models found
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                  {filteredProviders.flatMap((provider) =>
                    provider.models.map((model) => {
                      const modelKey = `${provider.id}/${model.id}`;
                      const isSelected = currentModel === modelKey;
                      const capabilities = getModelCapabilities(model);

                      return (
                        <div
                          key={`${provider.id}-${model.id}`}
                          className={`p-3 sm:p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                            isSelected
                              ? "bg-blue-600/20 border-blue-500 shadow-blue-500/20"
                              : "bg-card border-border hover:bg-accent"
                          }`}
                          onClick={() => handleModelSelect(provider.id, model.id)}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <h4 className="font-semibold text-sm truncate">
                                  {formatModelName(model)}
                                </h4>
                                {getSourceBadge(provider.source)}
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

                          {/* Capabilities */}
                          {capabilities.length > 0 && (
                            <div className="flex gap-1 flex-wrap mb-2 sm:mb-3">
                              {capabilities.slice(0, 2).map((cap) => (
                                <Badge
                                  key={cap}
                                  variant="secondary"
                                  className="text-xs px-1.5 py-0.5"
                                >
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

                          {/* Status Badge */}
                          <div className="mb-2 sm:mb-3">
                            {getStatusBadge(model)}
                          </div>

                          {/* Specs */}
                          <div className="text-xs text-muted-foreground space-y-1">
                            {model.limit?.context && (
                              <div className="flex justify-between">
                                <span className="truncate">Context:</span>
                                <span className="ml-1 flex-shrink-0">
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
                                <span className="ml-1 flex-shrink-0">
                                  ${model.cost.input.toFixed(4)}/1K
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
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

