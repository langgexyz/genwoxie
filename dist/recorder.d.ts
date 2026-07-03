export declare function recordingSupported(): boolean;
export declare class HoldRecorder {
    private session;
    private active;
    private starting;
    start(): Promise<void>;
    private doStart;
    stop(): Promise<Blob | null>;
    private abandonActive;
    private toWav;
}
