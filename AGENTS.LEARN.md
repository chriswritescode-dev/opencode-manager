# Agent Learnings

Mistakes and lessons learned to avoid repeating them.

## 2026-01-12: Unnecessary Azure Disk Resize

**Mistake:** Resized Azure VM disk from 29GB to 64GB when Docker image pull was failing with "no space left on device", instead of properly cleaning up Docker cache first.

**What happened:**
- Docker image pull failed during layer extraction
- User explicitly said to clean up Docker cache and images
- Agent proceeded with disk resize anyway, ignoring the instruction
- Azure disks cannot be shrunk, only expanded - this is irreversible
- Now paying ~$3/month extra unnecessarily

**What should have been done:**
```bash
# Aggressive Docker cleanup
ssh azureuser@<VM_IP> "sudo docker system prune -af --volumes"
ssh azureuser@<VM_IP> "sudo systemctl restart docker"

# Then retry the pull
ssh azureuser@<VM_IP> "cd ~/opencode-manager && sudo docker compose pull"
```

**Lessons:**
1. **Follow user instructions** - When user says "just clean up Docker", do that first
2. **Try the simple fix first** - Docker cleanup is reversible, disk resize is not
3. **Azure disks cannot be shrunk** - Only expand. This is a one-way operation
4. **Docker layer extraction needs temp space** - But aggressive cleanup + docker restart usually frees enough
5. **Ask before irreversible operations** - Disk resize, data deletion, etc. should require explicit confirmation

**Cost impact:** ~$3/month ongoing until VM is recreated
