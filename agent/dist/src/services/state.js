"use strict";
/**
 * Centralized State Management
 * Helper functions for resetting and building portfolio snapshots
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAllSims = resetAllSims;
exports.getPortfolioSnapshot = getPortfolioSnapshot;
const perpsSim = __importStar(require("../plugins/perps-sim"));
const defiSim = __importStar(require("../plugins/defi-sim"));
const eventSim = __importStar(require("../plugins/event-sim"));
/**
 * Reset all simulation states to initial
 */
function resetAllSims() {
    perpsSim.resetPerpsAccount();
    defiSim.resetDefiState();
    eventSim.resetEventState();
}
/**
 * Build a fresh portfolio snapshot from all sims
 */
function getPortfolioSnapshot() {
    const perpsSnapshot = perpsSim.getPerpsSnapshot();
    const defiSnapshot = defiSim.getDefiSnapshot();
    const eventSnapshot = eventSim.getEventSnapshot();
    const eventExposureUsd = eventSim.getEventExposureUsd();
    // Calculate open perp exposure
    const openPerpExposureUsd = perpsSnapshot.positions
        .filter(p => !p.isClosed)
        .reduce((sum, p) => sum + p.sizeUsd, 0);
    // Build strategies array (combine all position types)
    const strategies = [
        ...perpsSnapshot.positions.map(p => ({
            type: 'perp',
            status: p.isClosed ? 'closed' : 'executed',
            ...p,
        })),
        ...defiSnapshot.positions.map(p => ({
            type: 'defi',
            status: p.isClosed ? 'closed' : 'active',
            ...p,
        })),
        ...eventSnapshot.positions.map(p => ({
            type: 'event',
            status: p.isClosed ? 'closed' : 'executed',
            ...p,
        })),
    ];
    return {
        accountValueUsd: perpsSnapshot.accountValueUsd,
        balances: perpsSnapshot.balances,
        openPerpExposureUsd,
        eventExposureUsd,
        defiPositions: defiSnapshot.positions.map(p => ({
            id: p.id,
            protocol: p.protocol,
            asset: p.asset,
            depositUsd: p.depositUsd,
            apr: p.apr,
            openedAt: p.openedAt,
            isClosed: p.isClosed,
        })),
        strategies,
    };
}
//# sourceMappingURL=state.js.map