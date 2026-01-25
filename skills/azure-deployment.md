# Azure Deployment Skill

Complete guide for deploying opencode-manager to Azure VM with Caddy auth and Cloudflare tunnel.

## Quick Deploy (Fresh VM)

```bash
# Deploy to new Azure VM
bun run scripts/deploy.ts
```

This creates:
- Azure VM (Standard_B2s, Ubuntu 24.04)
- Docker + docker-compose
- Caddy reverse proxy with basic auth
- Cloudflare tunnel for HTTPS

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
# Pull latest code, rebuild containers
bun run scripts/deploy.ts --update

# Update environment variables only
bun run scripts/deploy.ts --update-env
```

### Sync OpenCode Auth

Sync local OAuth tokens (GitHub Copilot, Anthropic) to remote:

```bash
bun run scripts/deploy.ts --sync-auth
```

### Enable YOLO Mode

Auto-approve all permissions:

```bash
bun run scripts/deploy.ts --yolo
```

### Destroy Resources

```bash
bun run scripts/deploy.ts --destroy
```

## Manual SSH Operations

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
# Check all containers (should see 3: opencode-manager, caddy-auth, cloudflared-tunnel)
sudo docker ps

# View logs
sudo docker logs opencode-manager
sudo docker logs caddy-auth
sudo docker logs cloudflared-tunnel

# Restart all services
cd ~/opencode-manager && sudo docker compose restart

# Rebuild and restart
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

## Completing a Deployment

After Docker build completes on Azure:

```bash
# 1. Start containers
ssh azureuser@VM_IP "cd ~/opencode-manager && sudo docker compose up -d"

# 2. Enable YOLO mode
ssh azureuser@VM_IP "sudo docker exec opencode-manager sed -i 's/yolo = false/yolo = true/' /app/.opencode.json 2>/dev/null || true"

# 3. Get tunnel URL
ssh azureuser@VM_IP "sudo docker logs cloudflared-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"

# 4. Verify health
curl -u admin:PASSWORD "https://TUNNEL-URL/api/health"
curl -u admin:PASSWORD "https://TUNNEL-URL/api/stt/status"
curl -u admin:PASSWORD "https://TUNNEL-URL/api/tts/voices"
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

Set in `.env` or environment before deploying:

| Variable | Description |
|----------|-------------|
| AUTH_USERNAME | Basic auth username (default: admin) |
| AUTH_PASSWORD | Basic auth password (prompted if not set) |
| GITHUB_TOKEN | For cloning private repos |
| ANTHROPIC_API_KEY | Anthropic API key |
| OPENAI_API_KEY | OpenAI API key |
| GEMINI_API_KEY | Google Gemini API key |
| TARGET_HOST | Deploy to existing server (skips Azure VM creation) |

## Troubleshooting

### Containers Not Starting

```bash
# Check docker-compose logs
cd ~/opencode-manager && sudo docker compose logs

# Check disk space
df -h

# Check memory
free -h
```

### Tunnel Not Working

```bash
# Restart tunnel
sudo docker restart cloudflared-tunnel

# Check tunnel logs
sudo docker logs cloudflared-tunnel --tail 50
```

### Auth Not Working

```bash
# Check Caddy config
sudo docker exec caddy-auth cat /etc/caddy/Caddyfile

# Check Caddy logs
sudo docker logs caddy-auth
```

### STT/TTS Not Working

```bash
# Check model loading
sudo docker logs opencode-manager | grep -i whisper

# Restart app
sudo docker restart opencode-manager

# Wait for model loading (~60s)
sleep 60
curl -u admin:PASSWORD "https://TUNNEL-URL/api/stt/status"
```
