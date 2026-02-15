import { API_BASE_URL } from "@/config";
import { settingsApi } from "./settings";
import { fetchWrapper } from "./fetchWrapper";

export type ProviderSource = "configured" | "local" | "builtin";

export interface OpenCodeModel {
  id: string;
  providerID: string;
  name: string;
  api: {
    id: string;
    url?: string;
    npm: string;
  };
  status: "active" | "deprecated";
  headers: Record<string, string>;
  options: Record<string, unknown>;
  cost: {
    input: number;
    output: number;
    cache?: {
      read: number;
      write: number;
    };
  };
  limit: {
    context: number;
    output: number;
  };
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
  };
  variants?: Record<string, Record<string, unknown>>;
}

export interface OpenCodeProvider {
  id: string;
  source: "custom" | "builtin";
  name: string;
  env: string[];
  options: Record<string, unknown>;
  models: Record<string, OpenCodeModel>;
}

export interface Model {
  id: string;
  name: string;
  release_date?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit?: {
    context: number;
    output: number;
  };
  modalities?: {
    input: ("text" | "audio" | "image" | "video" | "pdf")[];
    output: ("text" | "audio" | "image" | "video" | "pdf")[];
  };
  experimental?: boolean;
  status?: "alpha" | "beta";
  options?: Record<string, unknown>;
  provider?: {
    npm: string;
  };
  variants?: Record<string, Record<string, unknown>>;
}

export interface Provider {
  id: string;
  name: string;
  api?: string;
  env: string[];
  npm?: string;
  models: Record<string, Model>;
  options?: Record<string, unknown>;
  source?: ProviderSource;
  isConnected?: boolean;
}

export interface ProviderWithModels {
  id: string;
  name: string;
  api?: string;
  env: string[];
  npm?: string;
  models: Model[];
  source: ProviderSource;
  isConnected: boolean;
}

interface ConfigProvider {
  npm?: string;
  name?: string;
  api?: string;
  options?: {
    baseURL?: string;
    [key: string]: unknown;
  };
  models?: Record<string, ConfigModel>;
}

interface ConfigModel {
  id?: string;
  name?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  [key: string]: unknown;
}

const LOCAL_PROVIDER_IDS = ["ollama", "lmstudio", "llamacpp", "jan"];

function classifyProviderSource(providerId: string, isFromConfig: boolean): ProviderSource {
  if (!isFromConfig) return "builtin";
  if (LOCAL_PROVIDER_IDS.includes(providerId.toLowerCase())) return "local";
  return "configured";
}


interface OpenCodeProviderResponse {
  all: OpenCodeProvider[];
  connected: string[];
  default: Record<string, string>;
}

async function getProvidersFromOpenCodeServer(): Promise<{ providers: Provider[]; connected: string[] }> {
  try {
    const response = await fetchWrapper<OpenCodeProviderResponse>(`${API_BASE_URL}/api/opencode/provider`);

    if (response?.all && Array.isArray(response.all)) {
      const connectedSet = new Set(response.connected || []);

      const providers = response.all.map((openCodeProvider: OpenCodeProvider) => {
        const models: Record<string, Model> = {};

        Object.entries(openCodeProvider.models).forEach(([modelId, openCodeModel]) => {
          models[modelId] = {
            id: modelId,
            name: openCodeModel.name,
            attachment: openCodeModel.capabilities.attachment,
            reasoning: openCodeModel.capabilities.reasoning,
            temperature: openCodeModel.capabilities.temperature,
            tool_call: openCodeModel.capabilities.toolcall,
            cost: {
              input: openCodeModel.cost.input,
              output: openCodeModel.cost.output,
              cache_read: openCodeModel.cost.cache?.read ?? 0,
              cache_write: openCodeModel.cost.cache?.write ?? 0,
            },
            limit: {
              context: openCodeModel.limit.context,
              output: openCodeModel.limit.output,
            },
            modalities: {
              input: Object.keys(openCodeModel.capabilities.input).filter(
                (key) => openCodeModel.capabilities.input[key as keyof typeof openCodeModel.capabilities.input]
              ) as ("text" | "audio" | "image" | "video" | "pdf")[],
              output: Object.keys(openCodeModel.capabilities.output).filter(
                (key) => openCodeModel.capabilities.output[key as keyof typeof openCodeModel.capabilities.output]
              ) as ("text" | "audio" | "image" | "video" | "pdf")[],
            },
            provider: {
              npm: openCodeModel.api.npm,
            },
            variants: openCodeModel.variants,
          };
        });

        return {
          id: openCodeProvider.id,
          name: openCodeProvider.name,
          env: openCodeProvider.env,
          models,
          options: openCodeProvider.options,
          isConnected: connectedSet.has(openCodeProvider.id),
        };
      });

      return { providers, connected: response.connected || [] };
    }
  } catch {
    // Silently return empty providers on failure - graceful degradation
  }

  return { providers: [], connected: [] };
}

export async function getProviders(): Promise<{ providers: Provider[]; connected: string[] }> {
  return await getProvidersFromOpenCodeServer();
}

async function getConfiguredProviders(connectedIds: Set<string>): Promise<ProviderWithModels[]> {
  try {
    const config = await settingsApi.getDefaultOpenCodeConfig();
    if (!config?.content?.provider) return [];

    const configProviders = config.content.provider as Record<string, ConfigProvider>;
    const result: ProviderWithModels[] = [];

    for (const [providerId, providerConfig] of Object.entries(configProviders)) {
      if (!providerConfig || typeof providerConfig !== "object") continue;

      const source = classifyProviderSource(providerId, true);
      const models: Model[] = [];

      if (providerConfig.models) {
        for (const [modelId, modelConfig] of Object.entries(providerConfig.models)) {
          if (!modelConfig || typeof modelConfig !== "object") continue;

          models.push({
            id: modelId,
            name: modelConfig.name || modelId,
            limit: modelConfig.limit ? {
              context: modelConfig.limit.context || 0,
              output: modelConfig.limit.output || 0,
            } : undefined,
          });
        }
      }

      result.push({
        id: providerId,
        name: providerConfig.name || providerId,
        api: providerConfig.api || providerConfig.options?.baseURL,
        env: [],
        npm: providerConfig.npm,
        models,
        source,
        isConnected: connectedIds.has(providerId),
      });
    }

    return result;
  } catch {
    // Silently return empty providers on failure - graceful degradation
    return [];
  }
}

export async function getProvidersWithModels(): Promise<ProviderWithModels[]> {
  const { providers: builtinProviders, connected } = await getProviders();
  const connectedIds = new Set(connected);

  const configuredProviders = await getConfiguredProviders(connectedIds);
  const configuredIds = new Set(configuredProviders.map((p) => p.id));

  const builtinResult: ProviderWithModels[] = builtinProviders
    .filter((provider) => !configuredIds.has(provider.id))
    .map((provider) => {
      const models = Object.entries(provider.models || {}).map(([id, model]) => ({
        ...model,
        id: id,
        name: model.name || id,
      }));
      return {
        id: provider.id,
        name: provider.name,
        api: provider.api,
        env: provider.env || [],
        npm: provider.npm,
        models,
        source: "builtin" as ProviderSource,
        isConnected: provider.isConnected ?? false,
      };
    });

  const allProviders = [...configuredProviders, ...builtinResult];

  allProviders.sort((a, b) => {
    if (a.isConnected !== b.isConnected) {
      return a.isConnected ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return allProviders;
}

export async function getModel(
  providerId: string,
  modelId: string,
): Promise<Model | null> {
  const providers = await getProvidersWithModels();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;

  return provider.models.find((m) => m.id === modelId) || null;
}

export function formatModelName(model: Model): string {
  return model.name || model.id;
}

export function formatProviderName(
  provider: Provider | ProviderWithModels,
): string {
  return provider.name || provider.id;
}

export const providerCredentialsApi = {
  list: async (): Promise<string[]> => {
    const { providers } = await fetchWrapper<{ providers: string[] }>(`${API_BASE_URL}/api/providers/credentials`);
    return providers;
  },

  getStatus: async (providerId: string): Promise<boolean> => {
    const { hasCredentials } = await fetchWrapper<{ hasCredentials: boolean }>(
      `${API_BASE_URL}/api/providers/${providerId}/credentials/status`
    );
    return hasCredentials;
  },

  set: async (providerId: string, apiKey: string): Promise<void> => {
    await fetchWrapper(`${API_BASE_URL}/api/providers/${providerId}/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
  },

  delete: async (providerId: string): Promise<void> => {
    await fetchWrapper(`${API_BASE_URL}/api/providers/${providerId}/credentials`, {
      method: 'DELETE',
    });
  },
};
