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
  const url = `${AGENT_API_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

