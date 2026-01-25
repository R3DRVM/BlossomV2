/**
 * Relayer
 * Sends transactions on behalf of users using session permissions
 */
/**
 * Send a relayed transaction using the relayer's private key
 * @param to Contract address
 * @param data Encoded function call data
 * @param value ETH value (default: 0)
 * @returns Transaction hash
 */
export declare function sendRelayedTx({ to, data, value, }: {
    to: string;
    data: string;
    value?: string;
}): Promise<string>;
//# sourceMappingURL=relayer.d.ts.map