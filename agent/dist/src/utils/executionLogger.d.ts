/**
 * Execution Replay Artifacts Logger
 * Logs executionRequest, plan, and executionResult for debugging
 */
import { BlossomExecutionRequest } from '../types/blossom';
import { Plan } from '../types/execution';
import { ExecutionResult } from '../types/blossom';
export interface ExecutionArtifact {
    timestamp: string;
    executionId: string;
    executionRequest?: BlossomExecutionRequest | null;
    plan?: Plan;
    executionResult: ExecutionResult;
    userAddress?: string;
    draftId?: string;
}
/**
 * Log an execution artifact
 */
export declare function logExecutionArtifact(artifact: Omit<ExecutionArtifact, 'timestamp' | 'executionId'>): void;
/**
 * Get all execution artifacts
 */
export declare function getExecutionArtifacts(): ExecutionArtifact[];
/**
 * Get execution artifact by ID
 */
export declare function getExecutionArtifact(executionId: string): ExecutionArtifact | undefined;
/**
 * Get execution artifacts for a user
 */
export declare function getExecutionArtifactsForUser(userAddress: string): ExecutionArtifact[];
/**
 * Clear all artifacts (for testing)
 */
export declare function clearExecutionArtifacts(): void;
/**
 * Dump artifacts as JSON (for support/debugging)
 */
export declare function dumpExecutionArtifacts(): string;
//# sourceMappingURL=executionLogger.d.ts.map