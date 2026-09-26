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

describe("OpenCodeConfigSchema - native V2 fields", () => {
  it("accepts native plugin entries with package objects", () => {
    const input = {
      plugins: ["plain-plugin", { package: "@scope/plugin", options: { enabled: true } }],
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.plugins).toEqual(input.plugins);
  });

  it("accepts a native permissions rule set", () => {
    const input = {
      permissions: [
        { action: "shell", resource: "*", effect: "allow" },
        { action: "read", resource: "src/**", effect: "deny" },
      ],
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.permissions).toEqual(input.permissions);
  });

  it("accepts skills as an array of paths or urls", () => {
    const input = { skills: ["https://example.com/skill", "./skills"] };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.skills).toEqual(input.skills);
  });

  it("still accepts the legacy skills object", () => {
    const input = { skills: { paths: [".opencode/skills"], urls: [] } };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.skills).toEqual(input.skills);
  });

  it("accepts a native mcp servers record", () => {
    const input = { mcp: { servers: { docs: { type: "remote", url: "https://example.com/mcp" } } } };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.mcp).toEqual(input.mcp);
  });

  it("accepts native top-level fields alongside legacy ones", () => {
    const input = {
      $schema: "https://opencode.ai/config.json",
      update: "notify",
      snapshots: true,
      username: "manager",
      agents: { assistant: { mode: "primary" } },
      commands: { review: { description: "Review changes" } },
      providers: { custom: { npm: "custom-provider" } },
      media: { image: { max_width: 2048 } },
      references: { docs: { path: "./docs" } },
      worktree: { directory: "../worktrees" },
      websearch: { provider: "random" },
      warming: false,
      compaction: { auto: true },
      experimental: { subagent_depth: 1 },
      tool_output: { max_lines: 500 },
      watcher: { ignore: ["node_modules"] },
      default_agent: "assistant",
      agent: { assistant: { mode: "primary" } },
    };
    const parsed = OpenCodeConfigSchema.parse(input);
    expect(parsed.update).toBe("notify");
    expect(parsed.snapshots).toBe(true);
    expect(parsed.username).toBe("manager");
    expect(parsed.agents?.assistant?.mode).toBe("primary");
    expect(parsed.providers?.custom?.npm).toBe("custom-provider");
    expect(parsed.default_agent).toBe("assistant");
  });

  it("rejects an unknown update mode", () => {
    expect(() => OpenCodeConfigSchema.parse({ update: "sometimes" })).toThrow();
  });
});
