import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setError(t('settings.saveApiKeyFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [provider, apiKey, onSuccess, t]);

  const handleClose = useCallback(() => {
    setApiKey("");
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  if (!provider) return null;

  const envVarName = provider.env?.[0] || `${provider.id.toUpperCase()}_API_KEY`;
  const isEditMode = mode === 'edit';

  return (
    <Dialog open={open} onOpenChange={handleClose} modal={false}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {isEditMode ? t('settings.updateApiKey', { name: provider.name }) : t('settings.connectProvider', { name: provider.name })}
          </DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? t('settings.enterNewApiKey', { name: provider.name })
              : t('settings.enterApiKey', { name: provider.name })
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">{t('settings.apiKey')}</Label>
            <Input
              id="api-key"
              type="password"
              placeholder={`${t('settings.enterYour')} ${envVarName}`}
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
              {t('settings.environmentVariable')}: <code className="bg-muted px-1 py-0.5 rounded">{envVarName}</code>
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
              {t('settings.getApiKey')}
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!apiKey.trim() || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEditMode ? t('common.updating') : t('common.connecting')}
              </>
            ) : (
              isEditMode ? t('common.update') : t('common.connect')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
