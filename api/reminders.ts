import { config, json, sameSecret, supabaseAs } from '../src/server/env.js';
import { runReminders, type DueSubscription } from '../src/server/reminders.js';
import { sendPush } from '../src/server/webpush.js';

// POST /api/reminders — called every 5 minutes by Supabase pg_cron (pg_net) with `Authorization: Bearer
// <CRON_SECRET>` (see supabase/setup/reminders-cron.sql). Sends the due push reminders.
export async function POST(request: Request): Promise<Response> {
  const c = config();
  if (!c.ok) return json(503, { error: 'not configured', missing: c.missing });
  const auth = request.headers.get('authorization') ?? '';
  if (!sameSecret(auth, `Bearer ${c.cronSecret}`)) return json(401, { error: 'unauthorized' });

  const db = supabaseAs(c.supabaseUrl, c.anonKey);
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, { p_secret: c.cronSecret, ...args });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  try {
    const report = await runReminders({
      dueData: (since) => rpc<DueSubscription[]>('push_due_data', { p_since: since }),
      claim: (id, key) => rpc<boolean>('push_claim', { p_subscription: id, p_key: key }),
      result: (id, key, outcome) => rpc<void>('push_result', { p_subscription: id, p_key: key, p_outcome: outcome }),
      send: (sub, payload) => sendPush(c.vapid, sub, payload),
    });
    return json(200, report);
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
}
