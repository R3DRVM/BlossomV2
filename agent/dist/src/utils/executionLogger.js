/**
 * Execution Replay Artifacts Logger
 * Logs executionRequest, plan, and executionResult for debugging
 */
// In-memory store (for MVP - can be replaced with file/DB later)
const executionArtifacts = [];
const MAX_ARTIFACTS = 100; // Keep last 100 executions
/**
 * Log an execution artifact
 */
export function logExecutionArtifact(artifact) {
    const fullArtifact = {
        ...artifact,
        timestamp: new Date().toISOString(),
        executionId: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
    executionArtifacts.push(fullArtifact);
    // Keep only last MAX_ARTIFACTS
    if (executionArtifacts.length > MAX_ARTIFACTS) {
        executionArtifacts.shift();
    }
    // Log to console in dev mode
    if (process.env.NODE_ENV !== 'production') {
        console.log('[executionLogger] Artifact logged:', {
            executionId: fullArtifact.executionId,
            timestamp: fullArtifact.timestamp,
            success: fullArtifact.executionResult.success,
            txHash: fullArtifact.executionResult.txHash,
            simulatedTxId: fullArtifact.executionResult.simulatedTxId,
        });
    }
}
/**
 * Get all execution artifacts
 */
export function getExecutionArtifacts() {
    return [...executionArtifacts];
}
/**
 * Get execution artifact by ID
 */
export function getExecutionArtifact(executionId) {
    return executionArtifacts.find(a => a.executionId === executionId);
}
/**
 * Get execution artifacts for a user
 */
export function getExecutionArtifactsForUser(userAddress) {
    return executionArtifacts.filter(a => a.userAddress?.toLowerCase() === userAddress.toLowerCase());
}
/**
 * Clear all artifacts (for testing)
 */
export function clearExecutionArtifacts() {
    executionArtifacts.length = 0;
}
/**
 * Dump artifacts as JSON (for support/debugging)
 */
export function dumpExecutionArtifacts() {
    return JSON.stringify(executionArtifacts, null, 2);
}
//# sourceMappingURL=executionLogger.js.map