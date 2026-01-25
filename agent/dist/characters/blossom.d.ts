/**
 * Blossom Character Definition
 * AI Trading Copilot for on-chain perps, DeFi, and event markets
 *
 * TODO: When integrating full ElizaOS, import Character from '@elizaos/core'
 * For MVP, we use a simplified character definition
 */
export interface Character {
    name: string;
    bio: string;
    settings: {
        secrets: Record<string, any>;
        avatar: string;
    };
    system: string;
}
export declare const blossomCharacter: Character;
//# sourceMappingURL=blossom.d.ts.map