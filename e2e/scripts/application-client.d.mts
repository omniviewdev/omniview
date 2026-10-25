export function applicationRequest<T>(request: { operation: 'open' | 'inspect' | 'restart' | 'control'; name: string; liveFrontend: boolean; command?: string; params?: unknown }): Promise<T>;
