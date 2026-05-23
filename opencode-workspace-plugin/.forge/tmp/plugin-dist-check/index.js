import { resolveConfig } from './config.js';
import { ManagerClient } from './manager-client.js';
import { createManagerWorkspaceAdapter } from './adapter.js';
export default async function OpenCodeManagerWorkspacePlugin(input, options) {
    const config = resolveConfig(options);
    const client = new ManagerClient(config);
    const adapter = createManagerWorkspaceAdapter(input, config, client);
    input.experimental_workspace.register('manager', adapter);
    return {};
}
//# sourceMappingURL=index.js.map