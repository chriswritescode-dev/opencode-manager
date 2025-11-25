import { settingsApi } from "./settings";
import axios from "axios";
import { API_BASE_URL } from "@/constants/api";

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
}

export interface Provider {
  id: string;
  name: string;
  api?: string;
  env: string[];
  npm?: string;
  models: Record<string, Model>;
  options?: Record<string, unknown>;
}

export interface ProviderWithModels {
  id: string;
  name: string;
  api?: string;
  env: string[];
  npm?: string;
  models: Model[];
}

// Default providers for common OpenCode setups
const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    api: "https://api.anthropic.com",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@anthropic-ai/sdk",
    models: {
      "claude-3-5-sonnet-20241022": {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet (October 2024)",
        release_date: "2024-10-22",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 3, output: 15 },
        limit: { context: 200000, output: 8192 },
        modalities: { input: ["text", "image"], output: ["text"] },
        experimental: false,
      },
      "claude-3-5-haiku-20241022": {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku (October 2024)",
        release_date: "2024-10-22",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 1, output: 5 },
        limit: { context: 200000, output: 8192 },
        modalities: { input: ["text", "image"], output: ["text"] },
        experimental: false,
      },
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    env: ["OPENAI_API_KEY"],
    npm: "openai",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        release_date: "2024-05-13",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 5, output: 15 },
        limit: { context: 128000, output: 4096 },
        modalities: {
          input: ["text", "image", "audio"],
          output: ["text", "audio"],
        },
        experimental: false,
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        release_date: "2024-07-18",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 0.15, output: 0.6 },
        limit: { context: 128000, output: 16384 },
        modalities: { input: ["text", "image"], output: ["text"] },
        experimental: false,
      },
    },
  },
  {
    id: "google",
    name: "Google",
    api: "https://generativelanguage.googleapis.com/v1beta",
    env: ["GOOGLE_API_KEY"],
    npm: "@google/generative-ai",
    models: {
      "gemini-1.5-pro": {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        release_date: "2024-02-15",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 3.5, output: 10.5 },
        limit: { context: 2000000, output: 8192 },
        modalities: {
          input: ["text", "image", "audio", "video"],
          output: ["text"],
        },
        experimental: false,
      },
      "gemini-1.5-flash": {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        release_date: "2024-02-15",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 0.075, output: 0.3 },
        limit: { context: 1000000, output: 8192 },
        modalities: {
          input: ["text", "image", "audio", "video"],
          output: ["text"],
        },
        experimental: false,
      },
    },
  },
];

async function getProvidersFromConfig(): Promise<Provider[]> {
  try {
    const configResponse = await settingsApi.getDefaultOpenCodeConfig();
    if (configResponse?.content?.provider) {
      const providerRecord = configResponse.content.provider as Record<string, Provider>;
      const providers = Object.entries(providerRecord).map(([id, provider]) => ({
        ...provider,
        id: provider.id || id,
      }));
      return providers;
    }
  } catch (error) {
    console.warn("Failed to load OpenCode config", error);
  }

  return DEFAULT_PROVIDERS;
}

export async function getProviders(): Promise<Provider[]> {
  return await getProvidersFromConfig();
}

export async function getProvidersWithModels(): Promise<ProviderWithModels[]> {
  const providers = await getProviders();

  const result = providers.map((provider) => {
    const models = Object.entries(provider.models || {}).map(([id, model]) => ({
      ...model,
      id: model.id || id,
      name: model.name || id,
    }));
    return {
      id: provider.id,
      name: provider.name,
      api: provider.api,
      env: provider.env || [],
      npm: provider.npm,
      models,
    };
  });

  return result;
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
    const { data } = await axios.get(`${API_BASE_URL}/api/providers/credentials`);
    return data.providers;
  },

  getStatus: async (providerId: string): Promise<boolean> => {
    const { data } = await axios.get(
      `${API_BASE_URL}/api/providers/${providerId}/credentials/status`
    );
    return data.hasCredentials;
  },

  set: async (providerId: string, apiKey: string): Promise<void> => {
    await axios.post(`${API_BASE_URL}/api/providers/${providerId}/credentials`, {
      apiKey,
    });
  },

  delete: async (providerId: string): Promise<void> => {
    await axios.delete(`${API_BASE_URL}/api/providers/${providerId}/credentials`);
  },
};
