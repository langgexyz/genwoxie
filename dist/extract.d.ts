export interface ExtractResult {
    char: string;
    context: string;
}
export declare function extractTargetCharacter(text: string): ExtractResult;
export declare function buildSpeechText(char: string, context: string): string;
