import { API_BASE_URL } from "@/config";
import { settingsApi } from "./settings";
import { fetchWrapper } from "./fetchWrapper";
import { callOpenCode } from "./opencodeApi";
import { openCodeLocation, type ConfigEntry, type FormAnswer, type ModelInfo } from "@opencode-manager/shared/opencode";
import type { CredentialListResponse, CredentialStatusResponse } from "@opencode-manager/shared/schemas";
import type { OpenCodeConfigFile } from "./types/settings";

export type ProviderSource = "configured" | "local" | "builtin";

export interface Model {
  id: string;
  key?: string;
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

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

export interface OpenCodeModelState {
  recent: ModelSelection[];
  favorite: ModelSelection[];
  variant: Record<string, string | undefined>;
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

export interface ProvidersResult {
  providers: Provider[];
  connected: string[];
  models: ModelInfo[];
}

const MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;
type ModelModality = (typeof MODEL_MODALITIES)[number];

const isModelModality = (value: string): value is ModelModality =>
  (MODEL_MODALITIES as readonly string[]).includes(value);

function mapModelInfo(model: ModelInfo): Model {
  const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0];
  return {
    id: model.modelID,
    key: model.id,
    name: model.name,
    release_date: new Date(model.time.released).toISOString().slice(0, 10),
    attachment: model.capabilities.input.some((item) => item !== "text"),
    reasoning: false,
    temperature: false,
    tool_call: model.capabilities.tools,
    cost: cost
      ? {
          input: cost.input,
          output: cost.output,
          cache_read: cost.cache.read,
          cache_write: cost.cache.write,
        }
      : undefined,
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    modalities: {
      input: model.capabilities.input.filter(isModelModality),
      output: model.capabilities.output.filter(isModelModality),
    },
    status: model.status === "alpha" ? "alpha" : model.status === "beta" ? "beta" : undefined,
    options: model.settings,
    variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.settings ?? {}])),
  };
}

export async function getProviders(directory?: string): Promise<ProvidersResult> {
  try {
    const location = openCodeLocation(directory);
    const [providerResult, modelResult] = await callOpenCode((api) =>
      Promise.all([api.provider.list(location), api.model.list(location)]),
    );

    const connected = providerResult.data.map((provider) => provider.id);
    const connectedSet = new Set(connected);

    const providers = providerResult.data.map((provider) => {
      const models: Record<string, Model> = {};
      for (const model of modelResult.data) {
        if (model.providerID !== provider.id || model.status === "deprecated") continue;
        models[model.id] = mapModelInfo(model);
      }
      return {
        id: provider.id,
        name: provider.name,
        env: [],
        models,
        options: provider.settings,
        isConnected: connectedSet.has(provider.id),
      };
    });

    return { providers, connected, models: modelResult.data };
  } catch {
    return { providers: [], connected: [], models: [] };
  }
}

type ConfigDocumentModel = Extract<ConfigEntry, { type: "document" }>["info"]["model"];

function formatConfigModel(model: NonNullable<ConfigDocumentModel>): string {
  return typeof model === "string" ? model : `${model.providerID}/${model.model}`;
}

export async function getOpenCodeConfigModel(directory?: string): Promise<string | null> {
  try {
    const entries = await callOpenCode((api) => api.config.get(openCodeLocation(directory)));
    const model = entries.reduce<ConfigDocumentModel>(
      (current, entry) => (entry.type === "document" && entry.info.model ? entry.info.model : current),
      undefined,
    );
    return model ? formatConfigModel(model) : null;
  } catch {
    return null;
  }
}

export async function getOpenCodeModelState(): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`);
}

export async function addOpenCodeRecentModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recent: model }),
  });
}

export async function removeOpenCodeRecentModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeRecent: model }),
  });
}

export async function toggleOpenCodeFavoriteModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: model }),
  });
}

async function getConfiguredProviders(connectedIds: Set<string>, config?: OpenCodeConfigFile): Promise<ProviderWithModels[]> {
  try {
    const resolvedConfig = config ?? await settingsApi.getOpenCodeConfig();
    const configured = {
      ...(resolvedConfig.content.providers as Record<string, ConfigProvider> | undefined),
      ...(resolvedConfig.content.provider as Record<string, ConfigProvider> | undefined),
    };
    if (Object.keys(configured).length === 0) return [];

    const result: ProviderWithModels[] = [];

    for (const [providerId, providerConfig] of Object.entries(configured)) {
      if (!providerConfig || typeof providerConfig !== "object") continue;

      const source = classifyProviderSource(providerId, true);
      const models: Model[] = [];

      if (providerConfig.models) {
        for (const [modelId, modelConfig] of Object.entries(providerConfig.models)) {
          if (!modelConfig || typeof modelConfig !== "object") continue;

          models.push({
            id: typeof modelConfig.id === 'string' ? modelConfig.id : modelId,
            key: modelId,
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

export async function getProvidersWithModels(directory?: string, config?: OpenCodeConfigFile): Promise<ProviderWithModels[]> {
  const { providers: resolvedProviders, connected } = await getProviders(directory);
  const connectedIds = new Set(connected);

  const configuredProviders = await getConfiguredProviders(connectedIds, config);
  const configuredById = new Map(configuredProviders.map((provider) => [provider.id, provider]));
  const resolvedIds = new Set(resolvedProviders.map((provider) => provider.id));

  const mergedProviders: ProviderWithModels[] = resolvedProviders.map((provider) => {
    const configured = configuredById.get(provider.id);
    const resolvedModels = Object.entries(provider.models || {}).map(([id, model]) => ({
      ...model,
      id: model.id || id,
      key: id,
      name: model.name || id,
    }));
    const resolvedModelIdentifiers = new Set(
      resolvedModels.flatMap((model) => [model.key, model.id]).filter((value): value is string => Boolean(value)),
    );
    const configuredOnlyModels = configured
      ? configured.models.filter(
          (model) =>
            !resolvedModelIdentifiers.has(model.key ?? "") && !resolvedModelIdentifiers.has(model.id),
        )
      : [];

    return {
      id: provider.id,
      name: provider.name || configured?.name || provider.id,
      api: provider.api ?? configured?.api,
      env: provider.env?.length ? provider.env : configured?.env ?? [],
      npm: provider.npm ?? configured?.npm,
      models: [...resolvedModels, ...configuredOnlyModels],
      source: configured ? configured.source : "builtin",
      isConnected: provider.isConnected ?? false,
    };
  });

  const configOnlyProviders = configuredProviders.filter((provider) => !resolvedIds.has(provider.id));

  const allProviders = [...mergedProviders, ...configOnlyProviders];

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
  directory?: string,
): Promise<Model | null> {
  const providers = await getProvidersWithModels(directory);
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
    const { providers } = await fetchWrapper<CredentialListResponse>(`${API_BASE_URL}/api/providers/credentials`);
    return providers;
  },

  getStatus: async (providerId: string): Promise<boolean> => {
    const { hasCredentials } = await fetchWrapper<CredentialStatusResponse>(
      `${API_BASE_URL}/api/providers/${providerId}/credentials/status`
    );
    return hasCredentials;
  },

  set: async (providerId: string, apiKey: string, answer?: FormAnswer): Promise<void> => {
    await fetchWrapper(`${API_BASE_URL}/api/providers/${providerId}/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, answer }),
    });
  },

  delete: async (providerId: string): Promise<void> => {
    await fetchWrapper(`${API_BASE_URL}/api/providers/${providerId}/credentials`, {
      method: 'DELETE',
    });
  },
};
