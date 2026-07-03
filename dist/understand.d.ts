export interface UnderstandResult {
    char: string;
    context: string;
}
export declare function probeUnderstandApi(timeoutMs?: number): Promise<boolean>;
export declare function requestUnderstand(wav: Blob): Promise<UnderstandResult>;
