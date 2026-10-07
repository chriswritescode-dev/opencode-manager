import { API_BASE_URL } from "@/config";
import { fetchWrapper } from "./fetchWrapper";
import { callOpenCode } from "./opencodeApi";
import {
  compareCatalogModels,
  formatOpenCodeModelRef,
  isModelFree,
  modelPreferenceKey,
  openCodeLocation,
  selectConfiguredModelRef,
  type FormAnswer,
  type ModelInfo,
  type ModelPreference,
  type ModelPreferenceModel,
  type ModelRef,
} from "@opencode-manager/shared/opencode";
import type { CredentialListResponse, CredentialStatusResponse } from "@opencode-manager/shared/schemas";

export interface Model {
  id: string;
  key?: string;
  name: string;
  limit?: {
    context: number;
    output: number;
  };
  released: number;
  free: boolean;
}

export interface Provider {
  id: string;
  name: string;
  models: Model[];
}

export interface ProviderCatalog {
  providers: Provider[];
  models: ModelInfo[];
}

export type ModelSelection = ModelPreferenceModel

export type OpenCodeModelState = ModelPreference

function mapModelInfo(model: ModelInfo): Model {
  return {
    id: model.modelID,
    key: model.id,
    name: model.name,
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    released: model.time.released,
    free: isModelFree(model),
  };
}

export async function getProviders(directory?: string): Promise<ProviderCatalog> {
  try {
    const location = openCodeLocation(directory);
    const [providerResult, modelResult] = await callOpenCode((api) =>
      Promise.all([api.provider.list(location), api.model.list(location)]),
    );

    const activeProviders = providerResult.data.filter((provider) => provider.activation !== "disabled");

    const providers = activeProviders.map((provider): Provider => {
      const models = modelResult.data
        .filter((model) => model.providerID === provider.id && model.status !== "deprecated" && model.enabled)
        .map(mapModelInfo);

      models.sort((a, b) =>
        compareCatalogModels(
          { ...a, providerID: provider.id, providerName: provider.name },
          { ...b, providerID: provider.id, providerName: provider.name },
        ),
      );

      return {
        id: provider.id,
        name: provider.name,
        models,
      };
    });

    providers.sort((a, b) =>
      compareCatalogModels(
        { providerID: a.id, providerName: a.name },
        { providerID: b.id, providerName: b.name },
      ),
    );

    return { providers, models: modelResult.data };
  } catch {
    return { providers: [], models: [] };
  }
}

export async function getOpenCodeConfiguredModel(directory?: string): Promise<string | null> {
  try {
    const entries = await callOpenCode((api) => api.config.get(openCodeLocation(directory)));
    const ref = selectConfiguredModelRef(entries);
    return ref ? formatOpenCodeModelRef(ref) : null;
  } catch {
    return null;
  }
}

export async function getOpenCodeServerDefaultModel(directory?: string): Promise<ModelRef | null> {
  try {
    const result = await callOpenCode((api) => api.model.default(openCodeLocation(directory)));
    const model = result.data;
    return model ? { providerID: model.providerID, id: model.id } : null;
  } catch {
    return null;
  }
}

export async function saveOpenCodeModelVariant(
  model: ModelSelection,
  value?: string | null,
): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: { model, value: value ?? null } }),
  });
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

export function formatModelName(model: Model): string {
  return model.name || model.id;
}

export function providerModelRef(provider: { id: string }, model: { id: string; key?: string }): string {
  return formatOpenCodeModelRef({ providerID: provider.id, id: model.key ?? model.id });
}

export function modelSelectionRef(model: ModelSelection): string {
  return modelPreferenceKey(model);
}

export function formatProviderName(provider: Provider): string {
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
