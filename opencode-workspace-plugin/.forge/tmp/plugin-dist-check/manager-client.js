export class ManagerClient {
    baseUrl;
    token;
    constructor(config) {
        this.baseUrl = config.managerUrl;
        this.token = config.managerToken;
    }
    async listWorkspaces() {
        const response = await fetch(`${this.baseUrl}/api/internal/opencode-workspaces`, {
            headers: {
                Authorization: `Bearer ${this.token}`,
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to list workspaces: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.workspaces;
    }
    async ensureTarget(repoId) {
        const response = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/opencode-target`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to ensure target: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
//# sourceMappingURL=manager-client.js.map