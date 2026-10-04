import { createNeonStore } from '../../../api/netlify/store.js';
import { ApiError, configuration, readBody, readTask } from '../../../api/netlify/security.js';
import { createCoach } from '../../../api/netlify/coach.js';
import { createNotifications } from '../../../api/netlify/notifications.js';

export default async request => {
  try {
    if (request.method !== 'POST') return;
    const cfg = configuration(process.env);
    const body = await readBody(request, 2048), task = readTask(cfg, body.token);
    if (!task || !/^[\w-]{20,30}$/.test(task.uid) || !/^[\w-]{20,30}$/.test(task.id)) return;
    const store = createNeonStore(process.env.DATABASE_URL), notifications = createNotifications({ store, cfg });
    if (task.type === 'rest') await notifications.rest(task.uid, task.id);
    else if (task.type === 'coach') {
      await createCoach({ store, cfg }).execute(task.uid, task.id);
      const rec = await store.get('coach:' + task.uid);
      if (rec?.pending?.id === task.id && rec.pending.changes?.length) {
        // Claim the notification separately: duplicate worker delivery cannot duplicate a push.
        const notify = await store.tx(['coach:' + task.uid], async tx => {
          const current = await tx.get('coach:' + task.uid);
          if (current?.pending?.id !== task.id || current.pending.notified) return false;
          current.pending.notified = true; await tx.set('coach:' + task.uid, current); return true;
        });
        if (notify) await notifications.send(task.uid, { title: 'Your Coach has been reading',
          body: `${rec.pending.changes.length} training suggestions ready to review`, tag: 'coach-proposal', url: '#/coach' });
      }
    }
  } catch (error) {
    // Invalid requests/configuration are not transient signed-task failures.
    // Do not spend retries on malformed or unauthenticated public requests.
    if (error instanceof ApiError) return;
    // Do not dump provider/database errors containing credentials or workout data.
    console.error('ForgeFit background task could not finish');
    throw new Error('ForgeFit background task failed');
  }
};
