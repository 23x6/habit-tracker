import { de, en } from '../src/i18n/messages.js';
import { config, json, supabaseAs } from '../src/server/env.js';
import type { PushPayload } from '../src/server/reminders.js';
import { sendPush } from '../src/server/webpush.js';

// POST /api/push-test — sends a test notification to the caller's own device.
// Authorization: the user's Supabase access token. The subscription is read as that user, so Row Level
// Security guarantees it belongs to them. Body: { "endpoint": "<this device's push endpoint>" }.
export async function POST(request: Request): Promise<Response> {
  const c = config();
  if (!c.ok) return json(503, { error: 'not configured' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return json(401, { error: 'unauthorized' });
  let endpoint: unknown;
  try {
    endpoint = ((await request.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return json(400, { error: 'invalid body' });
  }
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return json(400, { error: 'invalid endpoint' });

  const db = supabaseAs(c.supabaseUrl, c.anonKey, token);
  const { data: sub, error } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth,lang').eq('endpoint', endpoint).maybeSingle();
  if (error) return json(401, { error: error.message });
  if (!sub) return json(404, { error: 'not registered' });

  const m = sub.lang === 'en' ? en.push : de.push;
  const payload: PushPayload = { kind: 'test', title: m.testTitle, body: m.testBody, url: './', tag: 'test' };
  const outcome = await sendPush(c.vapid, sub, JSON.stringify(payload));
  if (outcome === 'gone') {
    await db.rpc('push_unregister', { p_endpoint: endpoint });
    return json(410, { error: 'subscription expired' });
  }
  return outcome === 'ok' ? json(200, { sent: true }) : json(502, { error: 'push service unavailable' });
}
