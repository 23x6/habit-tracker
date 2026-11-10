import type { Kind } from '../lib/db.js';
import { inputFromRecords, planReminders } from '../lib/pushPlan.js';

// Scheduler run (called by api/reminders.ts every 5 minutes through Supabase pg_cron → pg_net).
// Data access goes through the push_* SQL functions (supabase/migrations/20261112000000_push.sql), so the same
// code runs against the real database and the PGlite test server.

export interface DueSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  time_zone: string;
  lang: 'de' | 'en';
  records: { kind: Kind; data: unknown }[];
}

export type SendOutcome = 'ok' | 'gone' | 'retry';

export interface SchedulerDeps {
  dueData(since: string): Promise<DueSubscription[]>;
  /** true if this device hasn't been sent (or isn't being sent) this reminder yet. */
  claim(subscriptionId: string, key: string): Promise<boolean>;
  result(subscriptionId: string, key: string, outcome: SendOutcome): Promise<void>;
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<SendOutcome>;
}

export interface RunReport {
  devices: number;
  due: number;
  sent: number;
  duplicate: number;
  gone: number;
  retry: number;
  invalidZone: number;
}

/** Payload read by the service worker (src/sw-template.js). */
export interface PushPayload {
  kind: 'reminder' | 'test';
  title: string;
  body: string;
  url: string;
  tag: string;
}

export async function runReminders(deps: SchedulerDeps, now = new Date()): Promise<RunReport> {
  const report: RunReport = { devices: 0, due: 0, sent: 0, duplicate: 0, gone: 0, retry: 0, invalidZone: 0 };
  // Records from 8 days back cover the current week in every time zone and either week start.
  const since = new Date(now.getTime() - 8 * 86400000).toISOString().slice(0, 10);
  const subs = await deps.dueData(since);
  report.devices = subs.length;
  for (const sub of subs) {
    let plan;
    try {
      plan = planReminders(inputFromRecords(sub.records), now, sub.time_zone, sub.lang === 'en' ? 'en' : 'de');
    } catch {
      report.invalidZone++; // unknown time zone: skip this device, never guess
      continue;
    }
    for (const r of plan) {
      report.due++;
      if (!(await deps.claim(sub.id, r.key))) {
        report.duplicate++;
        continue;
      }
      const payload: PushPayload = { kind: 'reminder', title: r.title, body: r.body, url: r.url, tag: r.key };
      let outcome: SendOutcome;
      try {
        outcome = await deps.send(sub, JSON.stringify(payload));
      } catch {
        outcome = 'retry';
      }
      await deps.result(sub.id, r.key, outcome);
      if (outcome === 'ok') report.sent++;
      else if (outcome === 'retry') report.retry++;
      else {
        report.gone++;
        break; // the device is removed; nothing else can reach it
      }
    }
  }
  return report;
}
