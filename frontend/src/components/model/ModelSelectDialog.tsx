import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Check } from "lucide-react";
import {
  getProvidersWithModels,
  formatModelName,
  formatProviderName,
} from "@/api/providers";
import { useSettings } from "@/hooks/useSettings";
import { useOpenCodeClient } from "@/hooks/useOpenCode";
import { useParams } from "react-router-dom";
import type { ProviderWithModels, Model } from "@/api/providers";

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
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const { preferences, updateSettings } = useSettings();
  const client = useOpenCodeClient(opcodeUrl);
  const { sessionID } = useParams<{ sessionID: string }>();

  const currentModel = preferences?.defaultModel || "";

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProvidersWithModels();
      setProviders(data);

      if (currentModel) {
        const [providerId] = currentModel.split("/");
        setSelectedProvider(providerId);
      }
    } catch {
      // Ignore errors when loading providers
    } finally {
      setLoading(false);
    }
  }, [opcodeUrl, currentModel]);

  useEffect(() => {
    if (open) {
      loadProviders();
    }
  }, [open, loadProviders]);

  const filteredProviders = providers.filter((provider) => {
    const matchesSearch =
      provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.models.some(
        (model) =>
          model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          model.id.toLowerCase().includes(searchQuery.toLowerCase()),
      );

    const matchesProvider =
      !selectedProvider || provider.id === selectedProvider;

    return matchesSearch && matchesProvider;
  });

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

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId);
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
      <DialogContent className="max-w-4xl max-h-[80vh] bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Select Model
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search models or providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-card border-border text-foreground placeholder-muted-foreground"
            />
          </div>

          {/* Provider Filter */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={!selectedProvider ? "default" : "outline"}
              size="sm"
              onClick={() => handleProviderChange("")}
              className={
                !selectedProvider
                  ? "bg-blue-600 text-white"
                  : "bg-[#2a2a2a] border-[#333] text-zinc-300 hover:bg-[#333]"
              }
            >
              All Providers
            </Button>
            {providers.map((provider) => (
              <Button
                key={provider.id}
                variant={
                  selectedProvider === provider.id ? "default" : "outline"
                }
                size="sm"
                onClick={() => handleProviderChange(provider.id)}
                className={
                  selectedProvider === provider.id
                    ? "bg-blue-600 text-white"
                    : "bg-[#2a2a2a] border-[#333] text-zinc-300 hover:bg-[#333]"
                }
              >
                {formatProviderName(provider)}
              </Button>
            ))}
          </div>

          {/* Models List */}
          <div className="min-h-[300px] max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
              </div>
            ) : filteredProviders.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                No providers or models found
              </div>
            ) : (
              <div className="space-y-4">
                {filteredProviders.map((provider) => (
                  <div key={provider.id} className="space-y-2">
                    <h3 className="font-medium text-zinc-200 flex items-center gap-2">
                      {formatProviderName(provider)}
                      {provider.api && (
                        <Badge variant="outline" className="text-xs">
                          API
                        </Badge>
                      )}
                    </h3>
                    <div className="grid gap-2 pl-4">
                      {provider.models.map((model) => {
                        const modelKey = `${provider.id}/${model.id}`;
                        const isSelected = currentModel === modelKey;
                        const capabilities = getModelCapabilities(model);

                        return (
                          <div
                            key={model.id}
                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-blue-600/20 border-blue-500"
                                : "bg-[#0a0a0a] border-[#333] hover:bg-[#1a1a1a] hover:border-[#444]"
                            }`}
                            onClick={() =>
                              handleModelSelect(provider.id, model.id)
                            }
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-medium text-white">
                                    {formatModelName(model)}
                                  </h4>
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-blue-400" />
                                  )}
                                  {getStatusBadge(model)}
                                </div>
                                <p className="text-sm text-zinc-400 mb-2">
                                  {model.id}
                                </p>

                                {/* Capabilities */}
                                {capabilities.length > 0 && (
                                  <div className="flex gap-1 flex-wrap mb-2">
                                    {capabilities.map((cap) => (
                                      <Badge
                                        key={cap}
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {cap}
                                      </Badge>
                                    ))}
                                  </div>
                                )}

                                {/* Model Info */}
                                <div className="text-xs text-zinc-500 space-y-1">
                                  <div>
                                    Context:{" "}
                                    {model.limit?.context?.toLocaleString() ||
                                      "N/A"}{" "}
                                    tokens
                                  </div>
                                  <div>
                                    Output:{" "}
                                    {model.limit?.output?.toLocaleString() ||
                                      "N/A"}{" "}
                                    tokens
                                  </div>
                                  {model.cost && (
                                    <div>
                                      Cost: ${model.cost.input.toFixed(6)}
                                      /input, ${model.cost.output.toFixed(6)}
                                      /output
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current Selection */}
          {currentModel && (
            <div className="pt-4 border-t border-[#333]">
              <p className="text-sm text-zinc-400">
                Current model:{" "}
                <span className="text-white font-medium">{currentModel}</span>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

