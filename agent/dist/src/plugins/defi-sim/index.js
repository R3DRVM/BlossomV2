/**
 * DeFi Simulation Plugin
 * Simulates DeFi yield farming positions
 */
import { v4 as uuidv4 } from 'uuid';
// Available vaults with APRs
const VAULTS = {
    Kamino: { apr: 8.5, asset: 'USDC' },
    RootsFi: { apr: 6.4, asset: 'USDC' },
    Jet: { apr: 7.2, asset: 'USDC' },
};
let defiState = {
    positions: [],
};
// Reference to perps account for balance updates
let getUsdcBalance;
let updateUsdcBalance;
export function setBalanceCallbacks(getBalance, updateBalance) {
    getUsdcBalance = getBalance;
    updateUsdcBalance = updateBalance;
}
/**
 * Open a DeFi position
 */
export function openDefiPosition(protocol, asset, amountUsd) {
    const vault = VAULTS[protocol];
    if (!vault) {
        throw new Error(`Unknown protocol: ${protocol}`);
    }
    // Check USDC balance
    const currentBalance = getUsdcBalance ? getUsdcBalance() : 0;
    if (currentBalance < amountUsd) {
        throw new Error(`Insufficient USDC balance. Need $${amountUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
    }
    // Deduct from USDC
    if (updateUsdcBalance) {
        updateUsdcBalance(-amountUsd);
    }
    // Create position
    const position = {
        id: uuidv4(),
        protocol,
        asset: vault.asset,
        depositUsd: amountUsd,
        apr: vault.apr,
        openedAt: Date.now(),
        isClosed: false,
    };
    defiState.positions.push(position);
    return position;
}
/**
 * Close a DeFi position
 */
export function closeDefiPosition(id) {
    const position = defiState.positions.find(p => p.id === id && !p.isClosed);
    if (!position) {
        throw new Error(`Position ${id} not found or already closed`);
    }
    // Calculate yield (simple pro-rata APR)
    const elapsedMs = Date.now() - position.openedAt;
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    const yieldEarnedUsd = (position.depositUsd * position.apr * elapsedDays) / (100 * 365);
    // Update position
    position.isClosed = true;
    position.closedAt = Date.now();
    position.yieldEarnedUsd = yieldEarnedUsd;
    // Credit USDC with deposit + yield
    const totalReturn = position.depositUsd + yieldEarnedUsd;
    if (updateUsdcBalance) {
        updateUsdcBalance(totalReturn);
    }
    return { position, yieldEarned: yieldEarnedUsd };
}
/**
 * Get DeFi snapshot
 */
export function getDefiSnapshot() {
    return {
        positions: [...defiState.positions],
    };
}
/**
 * Reset DeFi state (for testing)
 */
export function resetDefiState() {
    defiState = {
        positions: [],
    };
}
//# sourceMappingURL=index.js.map