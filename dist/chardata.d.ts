export interface CharacterData {
    strokes: string[];
    medians: [number, number][][];
}
export declare function loadCharacterData(char: string): Promise<CharacterData | null>;
