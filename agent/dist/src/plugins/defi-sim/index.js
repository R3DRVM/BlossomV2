"use strict";
/**
 * DeFi Simulation Plugin
 * Simulates DeFi yield farming positions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBalanceCallbacks = setBalanceCallbacks;
exports.openDefiPosition = openDefiPosition;
exports.closeDefiPosition = closeDefiPosition;
exports.getDefiSnapshot = getDefiSnapshot;
exports.resetDefiState = resetDefiState;
const uuid_1 = require("uuid");
// Available vaults with APRs
const VAULTS = {
    Kamino: { apr: 8.5, asset: 'REDACTED' },
    RootsFi: { apr: 6.4, asset: 'REDACTED' },
    Jet: { apr: 7.2, asset: 'REDACTED' },
};
let defiState = {
    positions: [],
};
// Reference to perps account for balance updates
let getUsdcBalance;
let updateUsdcBalance;
function setBalanceCallbacks(getBalance, updateBalance) {
    getUsdcBalance = getBalance;
    updateUsdcBalance = updateBalance;
}
/**
 * Open a DeFi position
 */
function openDefiPosition(protocol, asset, amountUsd) {
    const vault = VAULTS[protocol];
    if (!vault) {
        throw new Error(`Unknown protocol: ${protocol}`);
    }
    // Check REDACTED balance
    const currentBalance = getUsdcBalance ? getUsdcBalance() : 0;
    if (currentBalance < amountUsd) {
        throw new Error(`Insufficient REDACTED balance. Need $${amountUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
    }
    // Deduct from REDACTED
    if (updateUsdcBalance) {
        updateUsdcBalance(-amountUsd);
    }
    // Create position
    const position = {
        id: (0, uuid_1.v4)(),
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
function closeDefiPosition(id) {
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
    // Credit REDACTED with deposit + yield
    const totalReturn = position.depositUsd + yieldEarnedUsd;
    if (updateUsdcBalance) {
        updateUsdcBalance(totalReturn);
    }
    return { position, yieldEarned: yieldEarnedUsd };
}
/**
 * Get DeFi snapshot
 */
function getDefiSnapshot() {
    return {
        positions: [...defiState.positions],
    };
}
/**
 * Reset DeFi state (for testing)
 */
function resetDefiState() {
    defiState = {
        positions: [],
    };
}
//# sourceMappingURL=index.js.map