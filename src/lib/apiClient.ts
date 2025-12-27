/**
 * API Client Configuration
 * Centralized base URL for agent API calls
 */

export const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_API_URL ?? 'http://localhost:3001';

/**
 * Wrapper for making requests to the agent API
 * @param path - API path (e.g., '/api/chat')
 * @param options - Fetch options (method, headers, body, etc.)
 */
export async function callAgent(path: string, options: RequestInit = {}): Promise<Response> {
  // Ensure no double slashes in URL
  const baseUrl = AGENT_API_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`; // Ensure leading slash
  const url = `${baseUrl}${cleanPath}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return response;
  } catch (error: any) {
    // Enhance error with URL and status info for debugging
    const enhancedError = new Error(
      `Agent API call failed: ${error.message || 'Network error'} | URL: ${url} | Status: ${error.status || 'N/A'}`
    ) as Error & { url?: string; status?: number };
    enhancedError.url = url;
    enhancedError.status = error.status;
    throw enhancedError;
  }
}

