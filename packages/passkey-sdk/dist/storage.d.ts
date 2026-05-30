export declare function saveCredential(contractId: string, credentialId: Uint8Array, publicKey: Uint8Array): void;
export declare function loadCredential(contractId: string): {
    credentialId: Uint8Array;
    publicKey: string;
} | null;
export declare function saveAccount(contractId: string): void;
export declare function loadAccounts(): string[];
export interface PendingAccount {
    contractId: string;
    secretKey: string;
}
export declare function savePendingAccount(contractId: string, secretKey: string): void;
export declare function loadPendingAccounts(): PendingAccount[];
export declare function removePendingAccount(contractId: string): void;
export declare function activateAccount(contractId: string): void;
export declare function saveAccountName(contractId: string, name: string): void;
export declare function loadAccountName(contractId: string): string | null;
export declare function saveFriendNickname(account: string, address: string, nickname: string): void;
export declare function loadFriendNicknames(account: string): Record<string, string>;
export interface SessionKeyMaterial {
    privateKey: Uint8Array;
    credentialId: string;
    label?: string;
}
export declare function saveSessionKeyMaterial(account: string, target: string, material: SessionKeyMaterial): void;
export declare function loadSessionKeyMaterial(account: string, target: string): SessionKeyMaterial | null;
export declare function forgetSessionKeyMaterial(account: string, target: string): void;
export declare function saveBlockLabel(account: string, ruleId: number, label: string): void;
export declare function loadBlockLabels(account: string): Record<number, string>;
//# sourceMappingURL=storage.d.ts.map