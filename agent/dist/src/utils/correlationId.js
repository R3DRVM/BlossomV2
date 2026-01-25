"use strict";
/**
 * Centralized Correlation ID Generator
 * Sprint 3.1.1: Ensures globally unique correlation IDs using crypto.randomUUID()
 *
 * Usage:
 *   import { makeCorrelationId } from './utils/correlationId';
 *   const corrId = makeCorrelationId('markets'); // "markets-550e8400-e29b-41d4-a716-446655440000"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCorrelationId = makeCorrelationId;
const crypto_1 = require("crypto");
/**
 * Generate a globally unique correlation ID with optional prefix
 * Uses crypto.randomUUID() for guaranteed uniqueness
 *
 * @param prefix Optional prefix (e.g., 'markets', 'swap', 'executor')
 * @returns Correlation ID in format: "prefix-uuid" or just "uuid" if no prefix
 */
function makeCorrelationId(prefix) {
    const uuid = (0, crypto_1.randomUUID)();
    return prefix ? `${prefix}-${uuid}` : uuid;
}
//# sourceMappingURL=correlationId.js.map