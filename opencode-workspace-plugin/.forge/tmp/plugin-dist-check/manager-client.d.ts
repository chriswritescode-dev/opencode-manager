import type { PluginConfig } from './config.js';
import type { ManagerWorkspaceSummary, EnsureOpenCodeTargetResponse } from './opencode-plugin-types.js';
export declare class ManagerClient {
    private baseUrl;
    private token;
    constructor(config: PluginConfig);
    listWorkspaces(): Promise<ManagerWorkspaceSummary[]>;
    ensureTarget(repoId: number): Promise<EnsureOpenCodeTargetResponse>;
}
//# sourceMappingURL=manager-client.d.ts.map