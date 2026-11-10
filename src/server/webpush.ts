import webpush from 'web-push';
import type { SendOutcome } from './reminders.js';

export interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Sends one encrypted Web Push message (RFC 8291, VAPID RFC 8292). 404/410 mean the subscription no longer
 * exists (unsubscribed, app removed, permission revoked): the device is dropped. Everything else is retried
 * by a later run within the reminder window. TTL: a reminder older than an hour is no longer useful.
 */
export async function sendPush(vapid: Vapid, sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<SendOutcome> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      vapidDetails: vapid,
      TTL: 3600,
      urgency: 'normal',
      timeout: 8000,
    });
    return 'ok';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'retry';
  }
}
