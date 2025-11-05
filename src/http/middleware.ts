import { validateSession } from '../auth/session';
import { htmlResponse } from './router';
import { renderLogin } from '../views/login';
import type { ForgeConfig } from '../types';

export interface AuthContext {
  pubkey: string | null;
  isAuthenticated: boolean;
}

export type Middleware = (req: Request) => Promise<Response | null>;

/**
 * Parse session cookie from request
 */
export function getSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'forge_session') {
      return value;
    }
  }

  return null;
}

/**
 * Create session middleware that protects routes
 */
export function createSessionMiddleware(config: ForgeConfig): Middleware {
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    
    // Skip auth for login, auth endpoints, and webhooks
    // Note: /hooks/post-receive must be public for git post-receive hooks to trigger CI
    const publicPaths = ['/login', '/auth/challenge', '/auth/verify', '/hooks/post-receive'];
    if (publicPaths.some(path => url.pathname.startsWith(path))) {
      return null;
    }

    // Dev mode bypass
    if (config.isDevelopment) {
      // Allow access in dev mode
      return null;
    }

    // Check session
    const sessionId = getSessionCookie(req);
    if (!sessionId) {
      return htmlResponse(renderLogin(), 401);
    }

    const pubkey = validateSession(sessionId);
    if (!pubkey) {
      // Session invalid, redirect to login
      return htmlResponse(renderLogin('Session expired. Please login again.'), 401);
    }

    // Session valid, continue to handler
    return null;
  };
}

/**
 * Get authenticated pubkey from session (for handlers that need it)
 */
export function getAuthenticatedPubkey(req: Request): string | null {
  const sessionId = getSessionCookie(req);
  if (!sessionId) {
    return null;
  }
  return validateSession(sessionId);
}
