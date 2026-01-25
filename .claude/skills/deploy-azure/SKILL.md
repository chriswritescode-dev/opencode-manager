---
name: deploy-azure
description: Deploy opencode-manager to Azure VM with Caddy auth and Cloudflare tunnel. Use when deploying to cloud, setting up remote access, or managing Azure infrastructure.
metadata:
  author: opencode-manager
  version: "1.0"
compatibility: Requires Azure CLI, Docker, and SSH access
---

Deploy opencode-manager to Azure VM with Caddy auth and Cloudflare tunnel.

## Quick Deploy

```bash
bun run scripts/deploy.ts
```

Creates Azure VM (Standard_B2s, Ubuntu 24.04), Docker, Caddy reverse proxy with basic auth, and Cloudflare tunnel.

Credentials saved to `.secrets/YYYY-MM-DD.json`

## Deploy to Existing Server

```bash
TARGET_HOST=your-server.com bun run scripts/deploy.ts
```

## Common Operations

### Check Status

```bash
bun run scripts/deploy.ts --status
```

### Update Deployment

```bash
bun run scripts/deploy.ts --update
bun run scripts/deploy.ts --update-env
```

### Sync OpenCode Auth

```bash
bun run scripts/deploy.ts --sync-auth
```

### Enable YOLO Mode

```bash
bun run scripts/deploy.ts --yolo
```

### Destroy Resources

```bash
bun run scripts/deploy.ts --destroy
```

## SSH Operations

### Get VM IP

```bash
az vm show -g opencode-manager-rg -n opencode-manager-vm -d --query publicIps -o tsv
```

### SSH to VM

```bash
ssh azureuser@$(az vm show -g opencode-manager-rg -n opencode-manager-vm -d --query publicIps -o tsv)
```

### Container Management

```bash
sudo docker ps
sudo docker logs opencode-manager
sudo docker logs caddy-auth
sudo docker logs cloudflared-tunnel
cd ~/opencode-manager && sudo docker compose restart
cd ~/opencode-manager && sudo docker compose up -d --build
```

### Get Tunnel URL

```bash
sudo docker logs cloudflared-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

### Enable YOLO Mode Manually

```bash
sudo docker exec opencode-manager sed -i 's/yolo = false/yolo = true/' /app/.opencode.json 2>/dev/null || true
```

## Complete Deployment

After Docker build completes:

```bash
ssh azureuser@VM_IP "cd ~/opencode-manager && sudo docker compose up -d"
ssh azureuser@VM_IP "sudo docker exec opencode-manager sed -i 's/yolo = false/yolo = true/' /app/.opencode.json 2>/dev/null || true"
ssh azureuser@VM_IP "sudo docker logs cloudflared-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"
curl -u admin:PASSWORD "https://TUNNEL-URL/api/health"
curl -u admin:PASSWORD "https://TUNNEL-URL/api/stt/status"
```

## Architecture

```
Cloudflare Tunnel (trycloudflare.com)
    |
Caddy (port 80, basic auth)
    |
opencode-manager app (port 5003)
    |-- OpenCode server (port 5551, internal)
    |-- Whisper STT (port 5552, internal)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| AUTH_USERNAME | Basic auth username (default: admin) |
| AUTH_PASSWORD | Basic auth password (prompted if not set) |
| GITHUB_TOKEN | For cloning private repos |
| ANTHROPIC_API_KEY | Anthropic API key |
| OPENAI_API_KEY | OpenAI API key |
| GEMINI_API_KEY | Google Gemini API key |
| TARGET_HOST | Deploy to existing server |

## Troubleshooting

### Containers Not Starting

```bash
cd ~/opencode-manager && sudo docker compose logs
df -h
free -h
```

### Tunnel Not Working

```bash
sudo docker restart cloudflared-tunnel
sudo docker logs cloudflared-tunnel --tail 50
```

### Auth Not Working

```bash
sudo docker exec caddy-auth cat /etc/caddy/Caddyfile
sudo docker logs caddy-auth
```

### STT/TTS Not Working

```bash
sudo docker logs opencode-manager | grep -i whisper
sudo docker restart opencode-manager
sleep 60
curl -u admin:PASSWORD "https://TUNNEL-URL/api/stt/status"
```
