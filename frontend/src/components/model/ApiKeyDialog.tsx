import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { oauthApi, type PromptAnswer, type PromptAnswerValue } from "@/api/oauth";
import { buildAnswer, defaultAnswer, hasMissingAnswers, setAnswerValue, visibleFields } from "@/lib/oauthFields";
import { mapOAuthError } from "@/lib/oauthErrors";
import { ProviderAuthField } from "@/components/settings/ProviderAuthField";

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
  const [answers, setAnswers] = useState<Record<string, PromptAnswer>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: authMethods } = useQuery({
    queryKey: ['provider-auth-methods'],
    queryFn: () => oauthApi.getAuthMethods(),
    enabled: open && !!provider,
  });

  const keyMethod = useMemo(
    () => (provider ? authMethods?.[provider.id]?.find((method) => method.type === 'key') : undefined),
    [authMethods, provider],
  );

  const answer = useMemo(
    () => (keyMethod ? { ...defaultAnswer(keyMethod), ...answers[keyMethod.id] } : {}),
    [keyMethod, answers],
  );

  const fields = useMemo(
    () => (keyMethod ? visibleFields(keyMethod, answer) : []),
    [keyMethod, answer],
  );

  const canSubmit = apiKey.trim().length > 0 && (!keyMethod || !hasMissingAnswers(keyMethod, answer));

  const handleAnswerChange = useCallback((methodID: string, key: string, value: PromptAnswerValue | undefined) => {
    setAnswers((prev) => setAnswerValue(prev, methodID, key, value));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!provider || !canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const requestAnswer = keyMethod && fields.length > 0 ? buildAnswer(keyMethod, answer) : undefined;
      await providerCredentialsApi.set(provider.id, apiKey.trim(), requestAnswer);
      setApiKey("");
      setAnswers({});
      onSuccess();
    } catch (err) {
      setError(mapOAuthError(err, 'credential'));
    } finally {
      setIsSubmitting(false);
    }
  }, [provider, canSubmit, keyMethod, fields, answer, apiKey, onSuccess]);

  const handleClose = useCallback(() => {
    setApiKey("");
    setAnswers({});
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
                if (e.key === "Enter" && canSubmit) {
                  handleSubmit();
                }
              }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Environment variable: <code className="bg-muted px-1 py-0.5 rounded">{envVarName}</code>
            </p>
          </div>

          {keyMethod && fields.length > 0 && (
            <div className="space-y-3">
              {fields.map((field) => (
                <ProviderAuthField
                  key={field.key}
                  field={field}
                  value={answer[field.key]}
                  disabled={isSubmitting}
                  onChange={(value) => handleAnswerChange(keyMethod.id, field.key, value)}
                />
              ))}
            </div>
          )}

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
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
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
