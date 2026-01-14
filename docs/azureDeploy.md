To Complete Deployment
The Docker build on Azure is running in the background. Once it completes:
# 1. Start the containers
ssh azureuser@4.246.110.199 "cd ~/opencode-manager && sudo docker compose up -d"
# 2. Enable YOLO mode
ssh azureuser@4.246.110.199 "sudo docker exec opencode-manager sed -i 's/yolo = false/yolo = true/' /app/.opencode.json 2>/dev/null || true"
# 3. Get tunnel URL
ssh azureuser@4.246.110.199 "sudo docker logs cloudflared-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"
# 4. Verify Coqui is installed
ssh azureuser@4.246.110.199 "sudo docker exec opencode-manager ls -la /opt/ | grep coqui"
# 5. Test health
curl -u admin:PASSWORD "https://TUNNEL-URL/api/health"
curl -u admin:PASSWORD "https://TUNNEL-URL/api/tts/coqui/status"