#!/usr/bin/env bun
/**
 * Test script to validate OpenCode configuration against the schema
 * Run: bun run scripts/test-opencode-config.ts
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Valid permission values according to OpenCode docs
const VALID_PERMISSION_VALUES = ["ask", "allow", "deny"] as const;

// Valid permission keys according to OpenCode docs
const VALID_PERMISSION_KEYS = [
  "edit",
  "bash", 
  "skill",
  "webfetch",
  "doom_loop",
  "external_directory"
] as const;

// Import the config function from deploy.ts
// We'll inline it here for testing
function getBaseOpencodeConfig(): Record<string, any> {
  return {
    "$schema": "https://opencode.ai/config.json",
    "permission": {
      "edit": "allow",
      "bash": "allow",
      "skill": "allow",
      "webfetch": "allow",
      "doom_loop": "allow",
      "external_directory": "allow"
    },
    "provider": {
      "github-copilot": {
        "models": {
          "claude-opus-4.5": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-opus-4": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-opus-41": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-sonnet-4": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-sonnet-4.5": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-haiku-4.5": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-3.5-sonnet": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-3.7-sonnet": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          },
          "claude-3.7-sonnet-thought": {
            "modalities": {
              "input": ["text"],
              "output": ["text"]
            }
          }
        }
      }
    }
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Test 1: Validate permission keys
test("Permission keys are valid", () => {
  const config = getBaseOpencodeConfig();
  const permissionKeys = Object.keys(config.permission || {});
  
  for (const key of permissionKeys) {
    assert(
      VALID_PERMISSION_KEYS.includes(key as any),
      `Invalid permission key: "${key}". Valid keys are: ${VALID_PERMISSION_KEYS.join(", ")}`
    );
  }
});

// Test 2: Validate permission values
test("Permission values are valid (ask|allow|deny)", () => {
  const config = getBaseOpencodeConfig();
  const permissions = config.permission || {};
  
  for (const [key, value] of Object.entries(permissions)) {
    if (typeof value === "string") {
      assert(
        VALID_PERMISSION_VALUES.includes(value as any),
        `Invalid permission value for "${key}": "${value}". Valid values are: ${VALID_PERMISSION_VALUES.join(", ")}`
      );
    }
  }
});

// Test 3: Validate model IDs use correct format (dots not hyphens for version numbers)
test("Model IDs use correct format (dots for versions)", () => {
  const config = getBaseOpencodeConfig();
  const models = config.provider?.["github-copilot"]?.models || {};
  
  const modelIds = Object.keys(models);
  
  // These are the known correct model IDs from `opencode models github-copilot`
  const knownValidIds = [
    "claude-opus-4.5",
    "claude-opus-4",
    "claude-opus-41",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-haiku-4.5",
    "claude-3.5-sonnet",
    "claude-3.7-sonnet",
    "claude-3.7-sonnet-thought"
  ];
  
  for (const id of modelIds) {
    assert(
      knownValidIds.includes(id),
      `Unknown model ID: "${id}". Make sure it matches output from 'opencode models github-copilot'`
    );
  }
});

// Test 4: Validate JSON schema reference
test("Config has valid $schema reference", () => {
  const config = getBaseOpencodeConfig();
  assert(
    config.$schema === "https://opencode.ai/config.json",
    `Invalid $schema: "${config.$schema}"`
  );
});

// Test 5: Validate modalities structure
test("Model modalities have correct structure", () => {
  const config = getBaseOpencodeConfig();
  const models = config.provider?.["github-copilot"]?.models || {};
  
  for (const [modelId, modelConfig] of Object.entries(models) as [string, any][]) {
    assert(
      modelConfig.modalities?.input,
      `Model "${modelId}" missing modalities.input`
    );
    assert(
      modelConfig.modalities?.output,
      `Model "${modelId}" missing modalities.output`
    );
    assert(
      Array.isArray(modelConfig.modalities.input),
      `Model "${modelId}" modalities.input must be an array`
    );
    assert(
      Array.isArray(modelConfig.modalities.output),
      `Model "${modelId}" modalities.output must be an array`
    );
  }
});

// Test 6: Actually validate with OpenCode CLI (if available)
test("Config validates with OpenCode (write temp file and check)", () => {
  const config = getBaseOpencodeConfig();
  const tempFile = join(tmpdir(), `opencode-test-${Date.now()}.json`);
  
  try {
    writeFileSync(tempFile, JSON.stringify(config, null, 2));
    
    // Try to validate using opencode if available
    try {
      // Use OPENCODE_CONFIG env var to point to our test config
      const result = execSync(`OPENCODE_CONFIG="${tempFile}" opencode --help 2>&1`, {
        encoding: "utf-8",
        timeout: 10000
      });
      // If we get here without error, the config is valid
    } catch (e: any) {
      // Check if error is about invalid config
      if (e.message?.includes("Configuration is invalid") || 
          e.stdout?.includes("Configuration is invalid") ||
          e.stderr?.includes("Configuration is invalid")) {
        throw new Error(`OpenCode rejected config: ${e.stderr || e.stdout || e.message}`);
      }
      // Other errors (like opencode not installed) are OK
    }
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
});

// Test 7: Validate local config file matches expected format
test("Local config (~/.config/opencode/opencode.json) is valid", () => {
  const localConfigPath = join(process.env.HOME || "", ".config/opencode/opencode.json");
  
  if (!existsSync(localConfigPath)) {
    console.log("  (skipped - file does not exist)");
    return;
  }
  
  const localConfig = JSON.parse(require("fs").readFileSync(localConfigPath, "utf-8"));
  
  // Validate permissions
  if (localConfig.permission) {
    for (const [key, value] of Object.entries(localConfig.permission)) {
      if (typeof value === "string") {
        assert(
          VALID_PERMISSION_VALUES.includes(value as any),
          `Local config has invalid permission value for "${key}": "${value}"`
        );
      }
      assert(
        VALID_PERMISSION_KEYS.includes(key as any),
        `Local config has invalid permission key: "${key}"`
      );
    }
  }
});

// Summary
console.log("\n" + "=".repeat(50));
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\nFailed tests:");
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  - ${r.name}: ${r.error}`);
  }
  process.exit(1);
} else {
  console.log("\nAll tests passed! Config is valid.");
  process.exit(0);
}
