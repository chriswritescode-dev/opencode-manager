import type { WorkspaceAdapter, WorkspaceInfo, WorkspaceTarget } from '@opencode-ai/plugin';
export type WorkspaceAdapterWithList = WorkspaceAdapter & {
    list?(): Promise<WorkspaceListedInfo[]> | WorkspaceListedInfo[];
};
export type WorkspaceListedInfo = {
    type: string;
    name: string;
    branch: string | null;
    directory: string | null;
    projectID: string;
    extra: unknown;
};
export type PluginInput = {
    experimental_workspace: {
        register(type: string, adapter: WorkspaceAdapterWithList): void;
    };
    project: {
        id: string;
    };
    serverUrl: URL;
};
export type PluginOptions = Record<string, unknown>;
export type ManagerWorkspaceSummary = {
    repoId: number;
    name: string;
    branch: string | null;
    cloneStatus: string;
    directory: string | null;
    extra: {
        repoId: number;
        localPath: string;
        fullPath: string;
    };
};
export type EnsureOpenCodeTargetResponse = {
    repoId: number;
    state: string;
    openCodeUrl: string;
    headers: Record<string, string>;
    reused: boolean;
};
export { WorkspaceInfo, WorkspaceTarget };
//# sourceMappingURL=opencode-plugin-types.d.ts.map