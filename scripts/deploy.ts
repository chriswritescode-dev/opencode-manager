#!/usr/bin/env bun
/**
 * Deploy opencode-manager with Basic Auth protection
 * 
 * Usage:
 *   bun run scripts/deploy.ts
 *   bun run scripts/deploy.ts --status
 *   bun run scripts/deploy.ts --destroy
 *   bun run scripts/deploy.ts --update
 *   bun run scripts/deploy.ts --update-env
 *   bun run scripts/deploy.ts --update-auth
 *   bun run scripts/deploy.ts --sync-auth
 *   bun run scripts/deploy.ts --yolo
 * 
 * Environment variables:
 *   AUTH_USERNAME - Basic auth username (default: admin)
 *   AUTH_PASSWORD - Basic auth password (prompted if not set)
 *   AZURE_LOCATION - Azure region (default: westus2)
 *   AZURE_VM_SIZE - VM size (default: Standard_D2s_v5)
 *   GITHUB_TOKEN - GitHub token for opencode-manager (cloning private repos)
 * 
 * OpenCode configuration:
 *   ANTHROPIC_API_KEY - Anthropic API key for Claude models
 *   OPENAI_API_KEY - OpenAI API key
 *   GEMINI_API_KEY - Google Gemini API key
 *   OPENROUTER_API_KEY - OpenRouter API key
 *   OPENCODE_CONFIG_FILE - Path to local opencode.json config to upload
 * 
 * OpenCode fork (for context overflow fix):
 *   OPENCODE_FORK_REPO - GitHub repo (e.g., "VibeTechnologies/opencode")
 *   OPENCODE_FORK_BRANCH - Branch to use (default: main)
 * 
 * Auth sync (--sync-auth):
 *   Syncs both OpenCode auth and GitHub token to the remote VM:
 *   - ~/.local/share/opencode/auth.json (GitHub Copilot, Anthropic OAuth, etc.)
 *   - GITHUB_TOKEN from environment/.env
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as readline from "readline";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");
const ENV_FILE = join(ROOT_DIR, ".env");
const SECRETS_DIR = join(ROOT_DIR, ".secrets");
const OPENCODE_AUTH_FILE = join(homedir(), ".local/share/opencode/auth.json");

let config = {
  resourceGroup: "opencode-manager-rg",
  location: "westus2",
  vmName: "opencode-manager-vm",
  vmSize: "Standard_D2s_v5",
  adminUser: "azureuser",
  authUsername: "admin",
  authPassword: "",
  githubToken: "",
  // OpenCode provider keys
  anthropicApiKey: "",
  openaiApiKey: "",
  geminiApiKey: "",
  openrouterApiKey: "",
  // OpenCode config file path
  opencodeConfigFile: "",
  // OpenCode fork (for context overflow fix)
  opencodeForkRepo: "",
  opencodeForkBranch: "main",
};

function exec(cmd: string, options?: { quiet?: boolean }): string {
  try {
    return execSync(cmd, { 
      encoding: "utf-8",
      stdio: options?.quiet ? "pipe" : "inherit"
    }) || "";
  } catch (e: any) {
    if (options?.quiet) return "";
    throw e;
  }
}

function execOutput(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

function execJson(cmd: string): any {
  const result = execSync(cmd, { encoding: "utf-8" });
  return JSON.parse(result);
}

function loadEnv() {
  if (existsSync(ENV_FILE)) {
    const content = readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        const trimmedKey = key.trim();
        if (!process.env[trimmedKey]) {
          process.env[trimmedKey] = value.trim();
        }
      }
    }
  }
}

function initConfig() {
  config = {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || "opencode-manager-rg",
    location: process.env.AZURE_LOCATION || "westus2",
    vmName: process.env.AZURE_VM_NAME || "opencode-manager-vm",
    vmSize: process.env.AZURE_VM_SIZE || "Standard_D2s_v5",
    adminUser: "azureuser",
    authUsername: process.env.AUTH_USERNAME || "admin",
    authPassword: process.env.AUTH_PASSWORD || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    // OpenCode provider keys
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
    // OpenCode config file path
    opencodeConfigFile: process.env.OPENCODE_CONFIG_FILE || "",
    // OpenCode fork (for context overflow fix)
    opencodeForkRepo: process.env.OPENCODE_FORK_REPO || "",
    opencodeForkBranch: process.env.OPENCODE_FORK_BRANCH || "main",
  };
}

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Enter password for Basic Auth: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function checkAzureLogin(): boolean {
  try {
    execSync("az account show", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function saveSecrets(url: string, username: string, password: string) {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true });
  }
  
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const secretsFile = join(SECRETS_DIR, `${date}.json`);
  
  const secrets = {
    url,
    username,
    password,
    createdAt: new Date().toISOString(),
  };
  
  writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
  console.log(`Secrets saved to ${secretsFile}`);
}

function getLatestSecrets(): { url: string; username: string; password: string } | null {
  if (!existsSync(SECRETS_DIR)) {
    return null;
  }
  
  const files = require("fs").readdirSync(SECRETS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    return null;
  }
  
  const latestFile = join(SECRETS_DIR, files[0]);
  try {
    return JSON.parse(readFileSync(latestFile, "utf-8"));
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateSecretsWithTunnelUrl(ip: string): Promise<string | null> {
  const sshOpts = "-o StrictHostKeyChecking=no";
  
  // Try app container first (new single-container setup), fallback to cloudflared-tunnel
  let tunnelLogs = execOutput(
    `ssh ${sshOpts} ${config.adminUser}@${ip} "sudo docker logs opencode-manager 2>&1 | grep trycloudflare || true"`
  );
  
  if (!tunnelLogs) {
    tunnelLogs = execOutput(
      `ssh ${sshOpts} ${config.adminUser}@${ip} "sudo docker logs cloudflared-tunnel 2>&1 || true"`
    );
  }
  
  // Get all URL matches and use the last one (most recent)
  const urlMatches = tunnelLogs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  if (urlMatches && urlMatches.length > 0) {
    const url = urlMatches[urlMatches.length - 1];
    
    // For token auth, we save the token location info instead of basic auth password
    saveSecrets(url, "token", "See ~/.config/opencode-manager.json on the server or container");
    console.log(`Tunnel URL: ${url}`);
    console.log(`Auth: Bearer token (check container logs or ~/.config/opencode-manager.json)`);
    return url;
  }
  
  console.log("Could not detect tunnel URL from container logs");
  return null;
}

function createResourceGroup() {
  console.log(`Creating resource group: ${config.resourceGroup}`);
  exec(`az group create --name ${config.resourceGroup} --location ${config.location}`, { quiet: true });
}

function createVM(): string {
  console.log(`Creating VM: ${config.vmName} (${config.vmSize})`);
  
  const cloudInit = `#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
runcmd:
  - systemctl enable docker
  - systemctl start docker
  - usermod -aG docker ${config.adminUser}
`;

  const cloudInitFile = join(ROOT_DIR, ".cloud-init.yml");
  writeFileSync(cloudInitFile, cloudInit);

  try {
    const result = execJson(`az vm create \
      --resource-group ${config.resourceGroup} \
      --name ${config.vmName} \
      --image Ubuntu2204 \
      --size ${config.vmSize} \
      --admin-username ${config.adminUser} \
      --generate-ssh-keys \
      --custom-data ${cloudInitFile} \
      --public-ip-sku Standard \
      --output json`);

    console.log(`VM created with IP: ${result.publicIpAddress}`);
    return result.publicIpAddress;
  } finally {
    unlinkSync(cloudInitFile);
  }
}

async function waitForVM(ip: string) {
  console.log("Waiting for VM to be ready...");
  const maxAttempts = 30;
  
  for (let i = 0; i < maxAttempts; i++) {
    const result = spawnSync("ssh", [
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=5",
      "-o", "BatchMode=yes",
      `${config.adminUser}@${ip}`,
      "echo ready"
    ], { encoding: "utf-8", stdio: "pipe" });

    if (result.status === 0) {
      console.log("\nVM is ready!");
      return;
    }
    process.stdout.write(".");
    await sleep(10000);
  }
  throw new Error("VM failed to become ready");
}

async function waitForDocker(ip: string) {
  console.log("Waiting for Docker to be ready...");
  const maxAttempts = 12;
  
  for (let i = 0; i < maxAttempts; i++) {
    const result = spawnSync("ssh", [
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=5",
      `${config.adminUser}@${ip}`,
      "docker --version"
    ], { encoding: "utf-8", stdio: "pipe" });

    if (result.status === 0) {
      console.log("Docker is ready!");
      return;
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  throw new Error("Docker failed to start");
}

async function deployToVM(ip: string) {
  console.log("Deploying opencode-manager to VM...");
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  // Clone opencode-manager
  const managerRepo = process.env.OPENCODE_MANAGER_REPO || "dzianisv/opencode-manager";
  console.log(`Cloning opencode-manager from ${managerRepo}...`);
  exec(`${sshCmd} "git clone https://github.com/${managerRepo}.git opencode-manager 2>/dev/null || (cd opencode-manager && git pull)"`, { quiet: true });

  // Create docker-compose.override.yml for single-container setup with built-in tunnel
  console.log("Configuring single-container deployment with token auth...");
  const composeOverride = `services:
  app:
    env_file:
      - .env
    ports:
      - "5003:5003"
    environment:
      - ENABLE_TUNNEL=true
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-unstable
      - CHROME_PATH=/usr/bin/google-chrome-unstable
      - CHROMIUM_PATH=/usr/bin/chromium
      - DISPLAY=:99
`;

  const composeBase64 = Buffer.from(composeOverride).toString("base64");
  exec(`${sshCmd} "echo '${composeBase64}' | base64 -d > ~/opencode-manager/docker-compose.override.yml"`, { quiet: true });

  // Create .env file with GitHub token, OpenCode provider keys, and fork config
  const envLines: string[] = [];
  if (config.githubToken) {
    envLines.push(`GITHUB_TOKEN=${config.githubToken}`);
  }
  if (config.anthropicApiKey) {
    envLines.push(`ANTHROPIC_API_KEY=${config.anthropicApiKey}`);
  }
  if (config.openaiApiKey) {
    envLines.push(`OPENAI_API_KEY=${config.openaiApiKey}`);
  }
  if (config.geminiApiKey) {
    envLines.push(`GEMINI_API_KEY=${config.geminiApiKey}`);
  }
  if (config.openrouterApiKey) {
    envLines.push(`OPENROUTER_API_KEY=${config.openrouterApiKey}`);
  }
  if (config.opencodeForkRepo) {
    envLines.push(`OPENCODE_FORK_REPO=${config.opencodeForkRepo}`);
    envLines.push(`OPENCODE_FORK_BRANCH=${config.opencodeForkBranch}`);
  }

  if (envLines.length > 0) {
    console.log("Configuring environment variables...");
    const envContent = envLines.join("\n");
    const envBase64 = Buffer.from(envContent).toString("base64");
    exec(`${sshCmd} "echo '${envBase64}' | base64 -d > ~/opencode-manager/.env"`, { quiet: true });
  }

  // Upload OpenCode config (always - includes base config with YOLO + vision disabled)
  await uploadOpencodeConfig(ip);

  // Sync OpenCode auth from local machine
  await uploadOpencodeAuth(ip);

  // Build and start
  console.log("Starting Docker containers (this may take a few minutes)...");
  exec(`${sshCmd} "cd ~/opencode-manager && sudo docker compose up -d --build"`, { quiet: false });

  // Wait for container to be ready and enable YOLO mode
  console.log("Waiting for container to start...");
  await sleep(5000);
  await enableYoloMode(ip);

  console.log("Deployment complete!");
}

function getVMIP(): string | null {
  try {
    const result = execSync(`az vm list-ip-addresses \
      --resource-group ${config.resourceGroup} \
      --name ${config.vmName} \
      --query "[0].virtualMachine.network.publicIpAddresses[0].ipAddress" \
      --output tsv`, { encoding: "utf-8" });
    return result.trim() || null;
  } catch {
    return null;
  }
}

function destroyResources() {
  console.log(`Destroying resource group: ${config.resourceGroup}`);
  exec(`az group delete --name ${config.resourceGroup} --yes --no-wait`);
  console.log("Destruction initiated (running in background)");
}

async function showStatus() {
  const ip = getVMIP();
  if (!ip) {
    console.log("No VM found");
    return;
  }

  console.log(`\nVM IP: ${ip}`);
  console.log(`SSH: ssh ${config.adminUser}@${ip}`);
  
  try {
    console.log("\nContainer status:");
    exec(`ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"`, { quiet: false });

    // Get tunnel URL from app container logs (new single-container setup)
    let tunnelLogs = execOutput(
      `ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker logs opencode-manager 2>&1 | grep trycloudflare || true"`
    );
    
    // Fallback to old cloudflared-tunnel container if exists
    if (!tunnelLogs) {
      tunnelLogs = execOutput(
        `ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker logs cloudflared-tunnel 2>&1 || true"`
      );
    }
    
    // Get all URL matches and use the last one (most recent)
    const urlMatches = tunnelLogs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (urlMatches && urlMatches.length > 0) {
      const currentUrl = urlMatches[urlMatches.length - 1];
      console.log(`\nTunnel URL: ${currentUrl}`);
      
      // Get token from container
      const tokenJson = execOutput(
        `ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker exec opencode-manager cat /home/node/.config/opencode-manager.json 2>/dev/null || echo ''"`
      );
      
      if (tokenJson) {
        try {
          const tokenData = JSON.parse(tokenJson);
          console.log(`API Token: ${tokenData.token}`);
          
          const secrets = getLatestSecrets();
          if (!secrets || secrets.url !== currentUrl) {
            saveSecrets(currentUrl, "token", tokenData.token);
          }
        } catch {
          console.log("Token: (check container logs for bootstrap token)");
        }
      } else {
        console.log("Token: (not yet generated - container may still be starting)");
      }
    } else {
      console.log("\nTunnel URL: (not detected - check if ENABLE_TUNNEL=true)");
    }

    console.log("\nOpenCode Manager logs (last 5 lines):");
    exec(`ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker logs opencode-manager 2>&1 | tail -5"`, { quiet: false });
  } catch {
    console.log("Could not fetch status");
  }
}

async function redeployAuth(ip: string) {
  console.log("Token-based authentication is now used.");
  console.log("To manage API tokens, use the Settings UI or API endpoints:");
  console.log("  - GET /api/auth/tokens - List tokens");
  console.log("  - POST /api/auth/tokens - Create new token");
  console.log("  - DELETE /api/auth/tokens/:id - Delete token");
  console.log("\nThe initial bootstrap token is saved to ~/.config/opencode-manager.json inside the container.");
  console.log("Run: ssh azureuser@" + ip + " 'sudo docker exec opencode-manager cat /home/node/.config/opencode-manager.json'");
}

async function updateEnv(ip: string) {
  console.log("Updating environment configuration...");
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  // Build env content
  const envLines: string[] = [];
  if (config.githubToken) {
    envLines.push(`GITHUB_TOKEN=${config.githubToken}`);
  }
  if (config.anthropicApiKey) {
    envLines.push(`ANTHROPIC_API_KEY=${config.anthropicApiKey}`);
  }
  if (config.openaiApiKey) {
    envLines.push(`OPENAI_API_KEY=${config.openaiApiKey}`);
  }
  if (config.geminiApiKey) {
    envLines.push(`GEMINI_API_KEY=${config.geminiApiKey}`);
  }
  if (config.openrouterApiKey) {
    envLines.push(`OPENROUTER_API_KEY=${config.openrouterApiKey}`);
  }
  if (config.opencodeForkRepo) {
    envLines.push(`OPENCODE_FORK_REPO=${config.opencodeForkRepo}`);
    envLines.push(`OPENCODE_FORK_BRANCH=${config.opencodeForkBranch}`);
  }

  if (envLines.length === 0 && !config.opencodeConfigFile) {
    console.log("No environment variables or config to update.");
    console.log("Set GITHUB_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY, etc. in your environment or .env file.");
    return;
  }

  if (envLines.length > 0) {
    const envContent = envLines.join("\n");
    const envBase64 = Buffer.from(envContent).toString("base64");
    exec(`${sshCmd} "echo '${envBase64}' | base64 -d > ~/opencode-manager/.env"`, { quiet: true });
    console.log("Environment file updated with: " + envLines.map(l => l.split("=")[0]).join(", "));
  }

  // Upload OpenCode config (always - includes base config with YOLO + vision disabled)
  await uploadOpencodeConfig(ip);

  // Restart the app container to pick up new env
  console.log("Restarting app container...");
  exec(`${sshCmd} "cd ~/opencode-manager && sudo docker compose up -d app"`, { quiet: true });
  console.log("Environment updated and app restarted!");
}

// Base OpenCode config - YOLO mode + vision disabled for GitHub Copilot
// GitHub Copilot vision is in "preview" and may not be enabled for all subscriptions
// Setting modalities to text-only prevents OpenCode from sending images to these models
// See: https://github.com/sst/opencode/issues/5291
function getBaseOpencodeConfig(): Record<string, any> {
  return {
    "$schema": "https://opencode.ai/config.json",
    // YOLO mode: auto-allow all permissions without asking
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
          // Use exact model IDs from: opencode models github-copilot
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

// Deep merge two objects, with source values taking precedence
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

async function uploadOpencodeConfig(ip: string) {
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  // Start with base config (YOLO + vision disabled for GitHub Copilot)
  let finalConfig = getBaseOpencodeConfig();

  // Merge user config if provided
  if (config.opencodeConfigFile) {
    const configPath = join(ROOT_DIR, config.opencodeConfigFile);
    if (existsSync(configPath)) {
      console.log(`Merging user config from ${config.opencodeConfigFile}...`);
      try {
        const userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        finalConfig = deepMerge(finalConfig, userConfig);
      } catch (e) {
        console.log(`Warning: Could not parse user config file: ${e}`);
      }
    } else {
      console.log(`Warning: OpenCode config file not found: ${configPath}`);
    }
  }

  console.log("Uploading OpenCode config (YOLO + vision disabled for GitHub Copilot)...");
  const configContent = JSON.stringify(finalConfig, null, 2);
  const configBase64 = Buffer.from(configContent).toString("base64");
  
  // Create the opencode config directory and upload config
  // The config goes to /workspace/.config/opencode/ which is the global config location inside the container
  exec(`${sshCmd} "mkdir -p ~/opencode-manager/workspace/.config/opencode"`, { quiet: true });
  exec(`${sshCmd} "echo '${configBase64}' | base64 -d > ~/opencode-manager/workspace/.config/opencode/opencode.json"`, { quiet: true });
  console.log("OpenCode config uploaded to workspace/.config/opencode/opencode.json");
}

async function uploadOpencodeAuth(ip: string) {
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  if (!existsSync(OPENCODE_AUTH_FILE)) {
    console.log("No local OpenCode auth.json found at ~/.local/share/opencode/auth.json");
    console.log("Run 'opencode' and use /connect to authenticate with providers first.");
    return false;
  }

  console.log("Uploading OpenCode authentication...");
  const authContent = readFileSync(OPENCODE_AUTH_FILE, "utf-8");
  const authBase64 = Buffer.from(authContent).toString("base64");
  
  // Copy auth.json directly into the running container's workspace volume
  exec(`${sshCmd} "sudo docker exec opencode-manager mkdir -p /workspace/.local/share/opencode"`, { quiet: true });
  exec(`${sshCmd} "echo '${authBase64}' | base64 -d | sudo docker exec -i opencode-manager tee /workspace/.local/share/opencode/auth.json > /dev/null"`, { quiet: true });
  exec(`${sshCmd} "sudo docker exec opencode-manager chmod 600 /workspace/.local/share/opencode/auth.json"`, { quiet: true });
  console.log("OpenCode auth uploaded (GitHub Copilot, Anthropic OAuth, etc.)");
  return true;
}

async function enableYoloMode(ip: string) {
  console.log("Enabling YOLO mode (auto-approve all permissions)...");
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  // Use base config with YOLO + vision disabled for GitHub Copilot
  const yoloConfig = JSON.stringify(getBaseOpencodeConfig(), null, 2);

  // Wait for opencode-manager to fully start and sync its config
  console.log("Waiting for opencode-manager to initialize...");
  const maxAttempts = 12;
  for (let i = 0; i < maxAttempts; i++) {
    const health = execOutput(`${sshCmd} "curl -s http://localhost:5003/api/health 2>/dev/null || echo 'not ready'"`);
    if (health.includes('"status":"ok"') || health.includes('ok')) {
      break;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  console.log(" ready!");

  // Wait a bit more for config sync to complete
  await sleep(3000);

  // Write config directly into the running container (AFTER opencode-manager syncs its config)
  // Use heredoc approach to avoid escaping issues
  const writeCmd = `${sshCmd} 'cat << "YOLOEOF" | sudo docker exec -i opencode-manager tee /workspace/.config/opencode/opencode.json > /dev/null
${yoloConfig}
YOLOEOF'`;
  exec(writeCmd, { quiet: true });

  // Verify the config was written correctly
  const verifyCmd = `${sshCmd} "sudo docker exec opencode-manager cat /workspace/.config/opencode/opencode.json"`;
  const writtenConfig = execOutput(verifyCmd);
  
  if (writtenConfig.includes('"permission"') && writtenConfig.includes('"allow"')) {
    console.log("YOLO mode enabled - all permissions will be auto-approved");
  } else {
    console.log("Warning: YOLO mode config may not have been written correctly");
    console.log("Written config:", writtenConfig);
    // Try one more time with base64
    const configBase64 = Buffer.from(yoloConfig).toString("base64");
    exec(`${sshCmd} "echo '${configBase64}' | base64 -d | sudo docker exec -i opencode-manager tee /workspace/.config/opencode/opencode.json > /dev/null"`, { quiet: true });
    console.log("Retried with base64 encoding");
  }
}

function getVMArch(ip: string): string {
  const sshOpts = "-o StrictHostKeyChecking=no";
  const arch = execOutput(`ssh ${sshOpts} ${config.adminUser}@${ip} "uname -m"`);
  if (arch === "aarch64" || arch === "arm64") {
    return "arm64";
  }
  return "amd64";
}

function patchDockerfile(ip: string) {
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;
  
  const vmArch = getVMArch(ip);
  console.log(`Detected VM architecture: ${vmArch}`);
  
  // Read the Dockerfile
  const dockerfile = execOutput(`${sshCmd} "cat ~/opencode-manager/Dockerfile"`);
  
  // Check if already patched
  if (dockerfile.includes('PUPPETEER_EXECUTABLE_PATH')) {
    console.log("Dockerfile already includes browser config, skipping patch");
    return;
  }
  
  // Add Chromium and browser dependencies to the apt-get install command
  let patchedDockerfile = dockerfile.replace(
    /python3-venv \\\n\s+&& rm -rf/,
    `python3-venv \\
    # Browser dependencies (works on both amd64 and arm64)
    chromium \\
    fonts-liberation \\
    libasound2 \\
    libatk-bridge2.0-0 \\
    libatk1.0-0 \\
    libatspi2.0-0 \\
    libcairo2 \\
    libcups2 \\
    libdbus-1-3 \\
    libdrm2 \\
    libgbm1 \\
    libglib2.0-0 \\
    libgtk-3-0 \\
    libnspr4 \\
    libnss3 \\
    libpango-1.0-0 \\
    libx11-6 \\
    libxcb1 \\
    libxcomposite1 \\
    libxdamage1 \\
    libxext6 \\
    libxfixes3 \\
    libxkbcommon0 \\
    libxrandr2 \\
    xdg-utils \\
    wget \\
    gnupg \\
    # Xvfb for running browser with extensions (non-headless)
    xvfb \\
    x11-utils \\
    && rm -rf`
  );
  
  // For amd64, also install Google Chrome Dev (not available on arm64)
  // For arm64, we only use Chromium which is available via apt
  let browserInstallBlock: string;
  
  if (vmArch === "amd64") {
    browserInstallBlock = `

# Install Google Chrome Dev (unstable) for latest features (amd64 only)
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \\
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \\
    && apt-get update \\
    && apt-get install -y google-chrome-unstable \\
    && rm -rf /var/lib/apt/lists/*

# Set Chrome environment variables (prefer Google Chrome on amd64)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-unstable
ENV CHROME_PATH=/usr/bin/google-chrome-unstable
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV DISPLAY=:99
`;
  } else {
    browserInstallBlock = `

# Set Chromium environment variables (arm64 - Google Chrome not available)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV DISPLAY=:99
`;
  }

  // Insert after the first RUN block (after rm -rf /var/lib/apt/lists/*)
  patchedDockerfile = patchedDockerfile.replace(
    /(RUN apt-get update && apt-get install -y[\s\S]*?&& rm -rf \/var\/lib\/apt\/lists\/\*)/,
    `$1${browserInstallBlock}`
  );
  
  // Write the patched Dockerfile back
  const dockerfileBase64 = Buffer.from(patchedDockerfile).toString("base64");
  exec(`${sshCmd} "echo '${dockerfileBase64}' | base64 -d > ~/opencode-manager/Dockerfile"`, { quiet: true });
  console.log(`Dockerfile patched with browser support for ${vmArch}`);
}

async function updateOpencode(ip: string) {
  console.log("Updating opencode-manager to latest version...");
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  // Detect VM architecture
  const vmArch = getVMArch(ip);
  console.log(`VM architecture: ${vmArch}`);

  // Check if we need to change the remote URL
  const managerRepo = process.env.OPENCODE_MANAGER_REPO || "dzianisv/opencode-manager";
  const currentRemote = execOutput(`${sshCmd} "cd ~/opencode-manager && git remote get-url origin 2>/dev/null || echo ''"`);
  if (currentRemote && !currentRemote.includes(managerRepo)) {
    console.log(`Changing remote to ${managerRepo}...`);
    exec(`${sshCmd} "cd ~/opencode-manager && git remote set-url origin https://github.com/${managerRepo}.git"`, { quiet: true });
  }

  // Pull latest code
  console.log("Pulling latest code from GitHub...");
  exec(`${sshCmd} "cd ~/opencode-manager && git fetch origin && git reset --hard origin/main"`, { quiet: false });

  // Patch Dockerfile to add Chrome and browser dependencies
  console.log("Patching Dockerfile to add browser support...");
  patchDockerfile(ip);

  // Update .env with fork settings if configured
  if (config.opencodeForkRepo) {
    console.log(`Configuring OpenCode fork: ${config.opencodeForkRepo}...`);
    let existingEnv = "";
    try {
      existingEnv = execOutput(`${sshCmd} "cat ~/opencode-manager/.env 2>/dev/null || echo ''"`);
    } catch {}

    const envLines = existingEnv.split("\n").filter(line => 
      line.trim() && !line.startsWith("OPENCODE_FORK_REPO=") && !line.startsWith("OPENCODE_FORK_BRANCH=")
    );
    envLines.push(`OPENCODE_FORK_REPO=${config.opencodeForkRepo}`);
    envLines.push(`OPENCODE_FORK_BRANCH=${config.opencodeForkBranch}`);
    
    const envContent = envLines.join("\n");
    const envBase64 = Buffer.from(envContent).toString("base64");
    exec(`${sshCmd} "echo '${envBase64}' | base64 -d > ~/opencode-manager/.env"`, { quiet: true });
  }

  // Set browser paths based on architecture
  const browserPath = vmArch === "amd64" ? "/usr/bin/google-chrome-unstable" : "/usr/bin/chromium";

  // Update docker-compose.override.yml for single-container setup with built-in tunnel
  console.log("Updating docker-compose.override.yml...");
  const composeOverride = `services:
  app:
    env_file:
      - .env
    ports:
      - "5003:5003"
    environment:
      - ENABLE_TUNNEL=true
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=${browserPath}
      - CHROME_PATH=${browserPath}
      - CHROMIUM_PATH=/usr/bin/chromium
      - DISPLAY=:99
`;
  const composeBase64 = Buffer.from(composeOverride).toString("base64");
  exec(`${sshCmd} "echo '${composeBase64}' | base64 -d > ~/opencode-manager/docker-compose.override.yml"`, { quiet: true });

  // Stop old containers (caddy, cloudflared) if they exist from previous setup
  console.log("Cleaning up old containers if present...");
  exec(`${sshCmd} "cd ~/opencode-manager && sudo docker compose down 2>/dev/null || true"`, { quiet: true });

  // Rebuild and restart
  console.log("Rebuilding and restarting app container (this may take a few minutes for first build)...");
  exec(`${sshCmd} "cd ~/opencode-manager && sudo docker compose up -d --build"`, { quiet: false });

  // Wait for container to be ready
  console.log("Waiting for container to start...");
  await sleep(5000);

  // Enable YOLO mode
  await enableYoloMode(ip);

  // Get existing tunnel URL (cloudflared container was not restarted)
  console.log("\nGetting tunnel URL...");
  await updateSecretsWithTunnelUrl(ip);

  console.log("\nUpdate complete! opencode-manager is now running the latest version with YOLO mode.");
}

async function syncAuth(ip: string) {
  console.log("Syncing authentication to remote VM...\n");
  const sshOpts = "-o StrictHostKeyChecking=no";
  const sshCmd = `ssh ${sshOpts} ${config.adminUser}@${ip}`;

  let hasChanges = false;

  // 1. Sync OpenCode auth.json directly into the container
  const authUploaded = await uploadOpencodeAuth(ip);
  if (authUploaded) hasChanges = true;

  // 2. Sync GitHub token to opencode-manager settings API and .env
  if (config.githubToken) {
    console.log("Syncing GitHub token...");
    
    // Update .env file for container environment
    let existingEnv = "";
    try {
      existingEnv = execOutput(`${sshCmd} "cat ~/opencode-manager/.env 2>/dev/null || echo ''"`);
    } catch {}

    const envLines = existingEnv.split("\n").filter(line => line.trim() && !line.startsWith("GITHUB_TOKEN="));
    envLines.push(`GITHUB_TOKEN=${config.githubToken}`);
    
    const envContent = envLines.join("\n");
    const envBase64 = Buffer.from(envContent).toString("base64");
    exec(`${sshCmd} "echo '${envBase64}' | base64 -d > ~/opencode-manager/.env"`, { quiet: true });
    
    // Also set gitToken in opencode-manager settings via API
    // Wait for container to be healthy first
    console.log("Waiting for API to be ready...");
    await sleep(3000);
    
    try {
      const settingsPayload = JSON.stringify({ preferences: { gitToken: config.githubToken } });
      exec(`${sshCmd} "curl -s -X PATCH http://localhost:5003/api/settings -H 'Content-Type: application/json' -d '${settingsPayload}'"`, { quiet: true });
      console.log("GitHub token synced to opencode-manager settings");
    } catch (e) {
      console.log("Warning: Could not update settings API (container may still be starting)");
    }
    
    hasChanges = true;
  } else {
    console.log("No GITHUB_TOKEN set in environment or .env file (skipping)");
  }

  if (hasChanges) {
    console.log("\nRestarting app container to pick up changes...");
    exec(`${sshCmd} "cd ~/opencode-manager && sudo docker compose restart app"`, { quiet: true });
    
    // Set gitToken via API after restart
    if (config.githubToken) {
      console.log("Waiting for container to restart...");
      await sleep(5000);
      try {
        const settingsPayload = JSON.stringify({ preferences: { gitToken: config.githubToken } });
        exec(`${sshCmd} "curl -s -X PATCH http://localhost:5003/api/settings -H 'Content-Type: application/json' -d '${settingsPayload}'"`, { quiet: true });
        console.log("GitHub token configured in opencode-manager");
      } catch (e) {
        console.log("Warning: Could not update settings API after restart");
      }
    }
    
    console.log("Auth synced and app restarted!");
  } else {
    console.log("\nNo authentication to sync.");
  }
}

async function main() {
  loadEnv();
  initConfig();

  const args = process.argv.slice(2);
  
  if (args.includes("--destroy")) {
    destroyResources();
    return;
  }

  if (args.includes("--status")) {
    await showStatus();
    return;
  }

  // 1. Use existing host if provided via env var
  const targetHost = process.env.TARGET_HOST;

  if (targetHost && !args.includes("--destroy") && !args.includes("--status")) {
    console.log(`ℹ️  TARGET_HOST is set to '${targetHost}'. Using existing server.`);
    console.log(`Checking SSH access...`);
    
    // Validate SSH access
    try {
      exec(`ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 ${config.adminUser}@${targetHost} "echo ready"`, { quiet: true });
    } catch (e) {
      console.error(`❌ Could not connect to ${targetHost}. Make sure you have SSH access with user '${config.adminUser}'.`);
      process.exit(1);
    }
    
    // Wait for Docker to be ready (or install it if missing? For now, assume pre-provisioned or use waitForDocker logic if it installs it)
    // Actually, let's verify docker exists, or install it using setup-dev.sh
    console.log("Checking for Docker...");
    try {
      exec(`ssh -o StrictHostKeyChecking=no ${config.adminUser}@${targetHost} "docker --version"`, { quiet: true });
    } catch {
      console.log("Docker not found. Installing dependencies...");
      exec(`ssh -o StrictHostKeyChecking=no ${config.adminUser}@${targetHost} "curl -sL https://raw.githubusercontent.com/dzianisv/opencode-manager/main/scripts/setup-dev.sh | bash"`, { quiet: false });
    }

    // Reuse deploy logic
    if (args.includes("--update")) {
      await updateOpencode(targetHost);
    } else if (args.includes("--update-env")) {
      await updateEnv(targetHost);
    } else if (args.includes("--sync-auth")) {
      await syncAuth(targetHost);
    } else if (args.includes("--yolo")) {
      await enableYoloMode(targetHost);
    } else {
       // Standard deploy
       await deployToVM(targetHost);
       console.log("\nDeployment to existing host complete!");
       // Show tunnel URL if available
       await updateSecretsWithTunnelUrl(targetHost);
    }
    return;
  }

  // Check Azure login
  if (!checkAzureLogin()) {
    console.error("Not logged into Azure. Run: az login");
    process.exit(1);
  }

  // Check if VM exists for update commands (these don't need password)
  const existingIP = getVMIP();
  
  if (existingIP && args.includes("--update")) {
    await updateOpencode(existingIP);
    return;
  }

  if (existingIP && args.includes("--yolo")) {
    await enableYoloMode(existingIP);
    return;
  }

  if (existingIP && args.includes("--sync-auth")) {
    await syncAuth(existingIP);
    return;
  }

  if (existingIP && args.includes("--update-env")) {
    await updateEnv(existingIP);
    return;
  }

  if (existingIP && args.includes("--update-auth")) {
    // Token auth is now used, just show info
    await redeployAuth(existingIP);
    return;
  }

  // No password needed for token-based auth

  console.log("\n=== OpenCode Manager Deployment ===\n");
  console.log(`Username: ${config.authUsername}`);
  console.log(`Password: ${config.authPassword}`);
  console.log("");

  createResourceGroup();
  const ip = createVM();
  await waitForVM(ip);
  await waitForDocker(ip);
  await deployToVM(ip);

  // Wait for tunnel and token generation
  console.log("\nWaiting for tunnel and token generation...");
  await sleep(20000);

  console.log("\n=== Deployment Summary ===");
  console.log(`VM IP: ${ip}`);
  console.log(`SSH: ssh ${config.adminUser}@${ip}`);
  
  // Get tunnel URL and token from container
  await updateSecretsWithTunnelUrl(ip);
  
  // Try to get the bootstrap token
  const tokenJson = execOutput(
    `ssh -o StrictHostKeyChecking=no ${config.adminUser}@${ip} "sudo docker exec opencode-manager cat /home/node/.config/opencode-manager.json 2>/dev/null || echo ''"`
  );
  
  if (tokenJson) {
    try {
      const tokenData = JSON.parse(tokenJson);
      console.log(`\nAPI Token: ${tokenData.token}`);
      console.log(`\nUse this token in the Authorization header:`);
      console.log(`  Authorization: Bearer ${tokenData.token}`);
    } catch {
      console.log("\nToken: (check container logs for bootstrap token)");
    }
  }
  
  console.log(`\nCommands:`);
  console.log(`  Status:  bun run scripts/deploy.ts --status`);
  console.log(`  Destroy: bun run scripts/deploy.ts --destroy`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
