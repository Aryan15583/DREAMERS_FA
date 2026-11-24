// Push notifications (Web Push): send a message to every device that turned notifications on.
const webpush = require('web-push');
const { db } = require('./db');

// Who is sending: an https address of the site, or a contact address (required by the push services)
function subject(origin) {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  return /^https:\/\//.test(origin || '') ? origin : 'mailto:notifications@dreamersfa.invalid';
}

/**
 * Send a notification.
 * @param settings  the app settings (holds the VAPID keys)
 * @param audience  'public' (people who asked for club news) or 'admin' (club admins)
 * @param message   { title, body, url, tag }
 * @returns { delivered, failed, removed }
 */
async function sendPush(settings, audience, message, origin) {
  const column = audience === 'admin' ? 'is_admin' : 'is_public';
  return sendPushTo(settings, `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE ${column} = 1`, [], message, origin);
}

// Send to the devices a query selects (e.g. one training centre's families)
async function sendPushTo(settings, sql, args, message, origin) {
  const subs = await db.all(sql, ...args);
  const payload = JSON.stringify({
    title: message.title,
    body: message.body || '',
    url: message.url || '/',
    tag: message.tag || undefined,
  });
  const options = {
    vapidDetails: { subject: subject(origin), publicKey: settings.vapid_public, privateKey: settings.vapid_private },
    TTL: 24 * 3600, // keep trying for a day if the phone is offline
    timeout: 8000,
  };
  let delivered = 0, failed = 0;
  const gone = [];
  // send in small batches so a big list doesn't open hundreds of connections at once
  for (let i = 0; i < subs.length; i += 25) {
    const batch = subs.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options)));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') { delivered++; return; }
      failed++;
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) gone.push(batch[j].id); // app uninstalled or notifications turned off
      else console.error('[push] send failed:', code || '', r.reason?.body || r.reason?.message);
    });
  }
  if (gone.length) await db.run(`DELETE FROM push_subscriptions WHERE id IN (${gone.map(() => '?').join(',')})`, ...gone);
  return { delivered, failed, removed: gone.length };
}

module.exports = { sendPush, sendPushTo };
