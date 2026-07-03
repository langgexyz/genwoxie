export interface UnderstandResult {
    char: string;
    context: string;
    auditId?: string;
}
export type AuditSignal = {
    kind: "correction";
    char: string;
    context: string;
} | {
    kind: "weak";
};
export declare function pollAuditSignal(auditId: string, signal: AbortSignal): Promise<AuditSignal | null>;
export declare function probeUnderstandApi(timeoutMs?: number): Promise<boolean>;
export declare function requestUnderstand(wav: Blob, prevAuditId?: string): Promise<UnderstandResult>;
