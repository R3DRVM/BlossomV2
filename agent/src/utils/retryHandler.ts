/**
 * Retry Handler with Exponential Backoff
 *
 * Provides configurable retry logic with:
 * - Exponential backoff with jitter
 * - Configurable retry conditions
 * - Rate limiting protection
 * - Timeout handling
 * - Detailed logging
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, adds randomness to delay
  timeout?: number; // Max time per attempt in ms
  retryCondition?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
  timeout: 30000,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number
): number {
  // Exponential: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (randomness)
  const jitter = cappedDelay * jitterFactor * Math.random();

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: Error): boolean {
  const message = (error.message || '').toLowerCase();
  const errorAny = error as any;

  return (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    message.includes('throttle') ||
    errorAny.status === 429 ||
    errorAny.statusCode === 429 ||
    errorAny.code === 'RATE_LIMITED'
  );
}

/**
 * Check if an error is retriable (network issues, timeouts, etc.)
 */
export function isRetriableError(error: Error): boolean {
  // Rate limit errors are retriable
  if (isRateLimitError(error)) return true;

  const message = (error.message || '').toLowerCase();
  const errorAny = error as any;

  return (
    // Network errors
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('connection') ||
    message.includes('fetch failed') ||
    // Timeout errors
    message.includes('timeout') ||
    message.includes('timed out') ||
    errorAny.code === 'ETIMEDOUT' ||
    errorAny.code === 'ECONNRESET' ||
    // Server errors (5xx)
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    errorAny.status === 500 ||
    errorAny.status === 502 ||
    errorAny.status === 503 ||
    errorAny.status === 504
  );
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitterFactor,
    timeout,
    retryCondition,
    onRetry,
  } = finalConfig;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wrap execution with timeout if configured
      if (timeout) {
        return await withTimeout(fn(), timeout);
      }
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      const shouldRetry = retryCondition
        ? retryCondition(error)
        : isRetriableError(error);

      // If not retriable or max retries reached, throw
      if (!shouldRetry || attempt >= maxRetries) {
        throw error;
      }

      // Calculate delay
      const delayMs = calculateBackoffDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterFactor
      );

      // Rate limit errors get extra delay
      const finalDelay = isRateLimitError(error) ? delayMs * 2 : delayMs;

      // Notify callback
      if (onRetry) {
        onRetry(attempt + 1, error, finalDelay);
      } else {
        console.log(
          `[retry] Attempt ${attempt + 1}/${maxRetries} failed: ${error.message?.slice(0, 100)}. ` +
          `Retrying in ${finalDelay}ms...`
        );
      }

      await sleep(finalDelay);
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Retry failed with unknown error');
}

/**
 * Execute a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Rate limiter for external API calls
 * Implements a simple token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRateMs: number; // Time to add one token

  constructor(
    maxRequestsPerMinute: number = 60,
    burstSize?: number
  ) {
    this.maxTokens = burstSize || maxRequestsPerMinute;
    this.tokens = this.maxTokens;
    this.refillRateMs = (60 * 1000) / maxRequestsPerMinute;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillRateMs);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Check if a request can be made (non-blocking)
   */
  canRequest(): boolean {
    this.refill();
    return this.tokens > 0;
  }

  /**
   * Try to acquire a token (non-blocking)
   * Returns true if acquired, false if rate limited
   */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /**
   * Acquire a token, waiting if necessary
   * Returns the wait time in ms (0 if no wait was needed)
   */
  async acquire(): Promise<number> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return 0;
    }

    // Calculate wait time for next token
    const waitTime = this.refillRateMs - (Date.now() - this.lastRefill);
    await sleep(waitTime);

    this.refill();
    this.tokens--;
    return waitTime;
  }

  /**
   * Get current state (for monitoring)
   */
  getState(): { tokens: number; maxTokens: number; refillRateMs: number } {
    this.refill();
    return {
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      refillRateMs: this.refillRateMs,
    };
  }
}

/**
 * Global rate limiters for different services
 */
const rateLimiters = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for a service
 */
export function getRateLimiter(
  serviceName: string,
  maxRequestsPerMinute: number = 60,
  burstSize?: number
): RateLimiter {
  if (!rateLimiters.has(serviceName)) {
    rateLimiters.set(
      serviceName,
      new RateLimiter(maxRequestsPerMinute, burstSize)
    );
  }
  return rateLimiters.get(serviceName)!;
}

/**
 * Execute a function with rate limiting
 */
export async function withRateLimit<T>(
  serviceName: string,
  fn: () => Promise<T>,
  maxRequestsPerMinute: number = 60
): Promise<T> {
  const limiter = getRateLimiter(serviceName, maxRequestsPerMinute);
  await limiter.acquire();
  return fn();
}

/**
 * Combine retry logic with rate limiting
 */
export async function withRetryAndRateLimit<T>(
  serviceName: string,
  fn: () => Promise<T>,
  options: {
    maxRequestsPerMinute?: number;
    retryConfig?: Partial<RetryConfig>;
  } = {}
): Promise<T> {
  const { maxRequestsPerMinute = 60, retryConfig } = options;

  return withRetry(
    () => withRateLimit(serviceName, fn, maxRequestsPerMinute),
    retryConfig
  );
}
