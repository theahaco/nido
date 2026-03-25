/**
 * Resolve a human-readable name to a contract address via the name registry.
 * Uses Soroban RPC simulation (read-only, no transaction submission).
 *
 * @returns The contract ID string, or null if the name is not registered.
 */
export declare function resolveName(rpcUrl: string, registryContractId: string, name: string, networkPassphrase: string): Promise<string | null>;
/**
 * Resolve a name with sessionStorage caching (5-minute TTL).
 */
export declare function resolveNameCached(rpcUrl: string, registryContractId: string, name: string, networkPassphrase: string): Promise<string | null>;
//# sourceMappingURL=resolve.d.ts.map