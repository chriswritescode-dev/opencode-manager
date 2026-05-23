export function resolveConfig(options = {}) {
    const managerUrl = options.managerUrl || process.env.OPENCODE_MANAGER_URL;
    if (!managerUrl) {
        throw new Error('managerUrl is required. Set it in plugin options or OPENCODE_MANAGER_URL env var.');
    }
    const managerToken = options.managerToken || process.env.OPENCODE_MANAGER_INTERNAL_TOKEN;
    if (!managerToken) {
        throw new Error('managerToken is required. Set it in plugin options or OPENCODE_MANAGER_INTERNAL_TOKEN env var.');
    }
    const connectionId = options.connectionId || 'default';
    return {
        managerUrl,
        managerToken,
        connectionId,
    };
}
//# sourceMappingURL=config.js.map