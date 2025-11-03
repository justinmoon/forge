import { verifyEvent, nip19 } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';

/**
 * Verify a signed Nostr event matches the expected challenge
 */
export function verifySignedEvent(event: NostrEvent, challenge: string): boolean {
  try {
    // Verify the signature is valid
    if (!verifyEvent(event)) {
      console.error('Invalid event signature');
      return false;
    }

    // Verify the event content matches the challenge
    if (event.content !== challenge) {
      console.error('Event content does not match challenge');
      return false;
    }

    // Verify the event kind is 27235 (NIP-98 auth event)
    if (event.kind !== 27235) {
      console.error('Invalid event kind, expected 27235');
      return false;
    }

    // Verify the event is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const eventAge = now - event.created_at;
    if (eventAge > 300 || eventAge < -60) {
      console.error('Event timestamp is too old or in the future');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error verifying event:', error);
    return false;
  }
}

/**
 * Convert npub to hex pubkey
 */
export function npubToHex(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
      throw new Error('Not a valid npub');
    }
    return decoded.data as string;
  } catch (error) {
    throw new Error(`Invalid npub: ${error}`);
  }
}

/**
 * Convert hex pubkey to npub
 */
export function hexToNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch (error) {
    throw new Error(`Invalid hex pubkey: ${error}`);
  }
}

/**
 * Check if a pubkey is in the whitelist
 */
export function isWhitelisted(pubkey: string, allowedPubkeys: string[]): boolean {
  return allowedPubkeys.includes(pubkey);
}
