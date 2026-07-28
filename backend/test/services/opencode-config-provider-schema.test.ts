import { describe, it, expect } from "vitest";
import { OpenCodeConfigSchema } from "@opencode-manager/shared/schemas";

describe("OpenCodeConfigSchema - provider api/npm round-trip", () => {
  it("preserves a provider-level api URL through parse", () => {
    const input = {
      provider: {
        "my-api": {
          name: "My API",
          api: "https://api.example.com/v1",
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.provider?.["my-api"]?.api).toBe("https://api.example.com/v1");
    expect(parsed.provider?.["my-api"]?.options?.baseURL).toBe("https://api.example.com/v1");
  });

  it("preserves a provider-level npm package through parse", () => {
    const input = {
      provider: {
        "my-npm": {
          name: "My NPM Provider",
          npm: "@scope/opencode-provider",
        },
      },
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.provider?.["my-npm"]?.npm).toBe("@scope/opencode-provider");
  });

  it("preserves whitelist and blacklist model filters through parse", () => {
    const input = {
      provider: {
        openai: {
          whitelist: ["gpt-4o", "gpt-4o-mini"],
          blacklist: ["gpt-3.5"],
        },
      },
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.provider?.openai?.whitelist).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(parsed.provider?.openai?.blacklist).toEqual(["gpt-3.5"]);
  });

  it("round-trips a full provider-with-models config without losing api or npm", () => {
    const input = {
      "$schema": "https://opencode.ai/config.json",
      provider: {
        custom: {
          name: "Custom",
          api: "https://api.custom.example/v1",
          npm: "custom-provider",
          models: {
            "custom-1": {
              id: "custom-1",
              name: "Custom 1",
              limit: { context: 200000, output: 8192 },
            },
          },
        },
      },
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    const roundTripped = OpenCodeConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped.provider?.custom?.api).toBe("https://api.custom.example/v1");
    expect(roundTripped.provider?.custom?.npm).toBe("custom-provider");
    expect(roundTripped.provider?.custom?.models?.["custom-1"]?.id).toBe("custom-1");
  });
});
