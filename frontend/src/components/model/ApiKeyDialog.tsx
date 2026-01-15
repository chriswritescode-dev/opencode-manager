import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Key, ExternalLink } from "lucide-react";
import { providerCredentialsApi } from "@/api/providers";
import type { ProviderWithModels } from "@/api/providers";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderWithModels | null;
  onSuccess: () => void;
  mode?: 'add' | 'edit';
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  provider,
  onSuccess,
  mode = 'add',
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!provider || !apiKey.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await providerCredentialsApi.set(provider.id, apiKey.trim());
      setApiKey("");
      onSuccess();
    } catch (err) {
      setError("Failed to save API key. Please try again.");
      console.error("Failed to set API key:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [provider, apiKey, onSuccess]);

  const handleClose = useCallback(() => {
    setApiKey("");
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  if (!provider) return null;

  const envVarName = provider.env?.[0] || `${provider.id.toUpperCase()}_API_KEY`;
  const isEditMode = mode === 'edit';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {isEditMode ? `Update ${provider.name} API Key` : `Connect ${provider.name}`}
          </DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? `Enter a new API key for ${provider.name}.`
              : `Enter your API key to use models from ${provider.name}.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder={`Enter your ${envVarName}`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && apiKey.trim()) {
                  handleSubmit();
                }
              }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Environment variable: <code className="bg-muted px-1 py-0.5 rounded">{envVarName}</code>
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {provider.api && (
            <a
              href={provider.api}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Get an API key
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!apiKey.trim() || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEditMode ? 'Updating...' : 'Connecting...'}
              </>
            ) : (
              isEditMode ? 'Update' : 'Connect'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
