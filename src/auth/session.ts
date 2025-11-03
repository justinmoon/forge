import { getDatabase } from '../db';
import { randomBytes } from 'crypto';

const SESSION_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

/**
 * Create a new session for the given pubkey
 */
export function createSession(pubkey: string): string {
  const db = getDatabase();
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_DURATION_MS;

  db.run(
    `INSERT INTO sessions (id, pubkey, created_at, expires_at, last_accessed)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, pubkey, now, expiresAt, now]
  );

  return sessionId;
}

/**
 * Validate a session and return the pubkey if valid
 */
export function validateSession(sessionId: string): string | null {
  const db = getDatabase();
  const now = Date.now();

  const row = db
    .query('SELECT pubkey, expires_at FROM sessions WHERE id = ?')
    .get(sessionId) as any;

  if (!row) {
    return null;
  }

  if (row.expires_at < now) {
    // Session expired, delete it
    deleteSession(sessionId);
    return null;
  }

  // Update last accessed time
  db.run('UPDATE sessions SET last_accessed = ? WHERE id = ?', [now, sessionId]);

  return row.pubkey;
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): void {
  const db = getDatabase();
  db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions(): void {
  const db = getDatabase();
  const now = Date.now();
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
}

/**
 * Get all sessions for a pubkey (for debugging/admin purposes)
 */
export function getSessionsByPubkey(pubkey: string): any[] {
  const db = getDatabase();
  return db
    .query('SELECT id, created_at, expires_at, last_accessed FROM sessions WHERE pubkey = ?')
    .all(pubkey) as any[];
}
