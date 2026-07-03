export declare function recordingSupported(): boolean;
export declare class HoldRecorder {
    private stream;
    private recorder;
    private starting;
    private chunks;
    start(): Promise<void>;
    private doStart;
    stop(): Promise<Blob | null>;
    private toWav;
}
