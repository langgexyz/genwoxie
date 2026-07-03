export interface UnderstandResult {
    char: string;
    context: string;
    auditId?: string;
}
export interface AuditCorrection {
    char: string;
    context: string;
}
export declare function pollAuditCorrection(auditId: string, signal: AbortSignal): Promise<AuditCorrection | null>;
export declare function probeUnderstandApi(timeoutMs?: number): Promise<boolean>;
export declare function requestUnderstand(wav: Blob): Promise<UnderstandResult>;
