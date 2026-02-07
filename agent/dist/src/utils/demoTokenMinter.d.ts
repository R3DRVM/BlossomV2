/**
 * Mints demo tokens (bUSDC and WETH) to a recipient address
 * Used for testnet faucet functionality
 */
export declare function mintDemoTokens(recipientAddress: string): Promise<{
    txHashes: {
        usdc: `0x${string}`;
        weth: `0x${string}`;
    };
    amounts: {
        usdc: string;
        weth: string;
    };
}>;
/**
 * Mint a custom amount of bUSDC for testnet use.
 * Amount is in whole bUSDC units (6 decimals applied internally).
 */
export declare function mintBusdc(recipientAddress: string, amount: number): Promise<{
    txHash: `0x${string}`;
    amount: number;
}>;
//# sourceMappingURL=demoTokenMinter.d.ts.map