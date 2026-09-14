import '../theme/swissVoid.css';
import { compileCapture } from '@core/captureCompilerCore';
import { storageService } from '../services/storageService';
import { scheduleAlarm, updateOverdueBadge } from '../services/alarmService';
import { syncService } from '../services/syncService';
import { Reminder } from '../types/reminder';

/**
 * Remy Web Browser Extension - Quick Capture Popup
 */
document.addEventListener('DOMContentLoaded', async () => {
  await storageService.init();

  const input = document.getElementById('capture-input') as HTMLInputElement | null;
  if (input) {
    input.focus();
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const text = input.value.trim();
        const config = storageService.getConfig();
        const draft = compileCapture(text, 'inbox', new Date(), config.customLingo || undefined);

        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `remy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const reminder: Reminder = {
          id,
          title: draft.title || text,
          dueDate: draft.dueDate.toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: draft.armed,
        };

        await storageService.saveReminder(reminder);
        if (reminder.armed) {
          await scheduleAlarm(reminder);
        }
        await updateOverdueBadge();
        syncService.triggerDebouncedSync(300).catch(() => {});

        window.close();
      }
    });
  }
});
