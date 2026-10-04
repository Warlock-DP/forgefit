import { createNeonStore } from '../../../api/netlify/store.js';
import { configuration, isOn } from '../../../api/netlify/security.js';
import { createNotifications } from '../../../api/netlify/notifications.js';

export default async () => {
  if (!isOn(process.env.SCHEDULED_NOTIFICATIONS_ENABLED)) return;
  try {
    const cfg = configuration(process.env), store = createNeonStore(process.env.DATABASE_URL);
    await createNotifications({ store, cfg }).scheduled();
  } catch { console.error('ForgeFit scheduled notifications could not finish'); }
};
// A minute-by-minute cron would keep the Free Neon database awake all month.
// Fifteen-minute checks trade exact timing for scale-to-zero and lower free-tier usage.
export const config = { schedule: '*/15 * * * *' };
