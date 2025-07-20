/**
 * Utility functions for working with JWT tokens
 */

/**
 * Decodes a JWT token and returns the payload
 * @param token JWT token string
 * @returns Decoded payload as an object or null if invalid
 */
export function decodeJwt(token: string): { exp?: number } | null {
  try {
    // JWT tokens are made up of three parts: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // The payload is the second part, base64 encoded
    const base64Payload = parts[1];
    // Replace characters for base64url to base64
    const base64 = base64Payload.replace(/-/g, '+').replace(/_/g, '/');
    // Decode the base64 string
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 * @param token JWT token string
 * @returns true if token is expired or invalid, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  if (!token) return true;

  const payload = decodeJwt(token);
  if (!payload || !payload.exp) return true;

  // exp is in seconds, Date.now() is in milliseconds
  const currentTime = Math.floor(Date.now() / 1000);
  return payload.exp < currentTime;
}

/**
 * Checks if a token will expire soon (within the specified buffer time)
 * @param token JWT token string
 * @param bufferSeconds Time buffer in seconds (default: 300 seconds = 5 minutes)
 * @returns true if token will expire soon, false otherwise
 */
export function willTokenExpireSoon(token: string, bufferSeconds = 300): boolean {
  if (!token) return true;

  const payload = decodeJwt(token);
  if (!payload || !payload.exp) return true;

  const currentTime = Math.floor(Date.now() / 1000);
  return payload.exp < currentTime + bufferSeconds;
}