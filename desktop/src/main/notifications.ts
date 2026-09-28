import { Notification } from 'electron';
import { LocalLedger } from './ledger';
import { SyncEngine } from './syncEngine';
import { Reminder } from '../types';

export class NotificationService {
  private ledger: LocalLedger;
  private syncEngine: SyncEngine;
  private onOpenAgenda: () => void;
  private checkTimer: NodeJS.Timeout | null = null;
  private notifiedDueDates: Map<string, string> = new Map();

  constructor(ledger: LocalLedger, syncEngine: SyncEngine, onOpenAgenda: () => void) {
    this.ledger = ledger;
    this.syncEngine = syncEngine;
    this.onOpenAgenda = onOpenAgenda;
  }

  public start(intervalMs: number = 10000): void {
    this.stop();
    this.checkTimer = setInterval(() => {
      this.checkDueReminders();
    }, intervalMs);
    // Initial check
    this.checkDueReminders();
  }

  public stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  public checkDueReminders(): Reminder[] {
    const due = this.ledger.getDueReminders();
    const newlyTriggered: Reminder[] = [];

    for (const rem of due) {
      if (this.notifiedDueDates.get(rem.id) === rem.dueDate) {
        continue;
      }
      this.notifiedDueDates.set(rem.id, rem.dueDate);
      newlyTriggered.push(rem);
      this.dispatchNotification(rem);
    }

    return newlyTriggered;
  }

  public dispatchNotification(rem: Reminder): void {
    if (!Notification.isSupported()) {
      return;
    }

    const notif = new Notification({
      title: 'Remy Reminder',
      body: rem.title + (rem.notes ? `\n${rem.notes}` : ''),
      silent: false,
      urgency: 'critical',
      actions: [
        { type: 'button', text: '+15m Snooze' },
        { type: 'button', text: 'Complete' },
      ],
    });

    notif.on('click', () => {
      this.onOpenAgenda();
    });

    notif.on('action', (_event, index) => {
      if (index === 0) {
        // +15m Snooze
        this.snoozeReminder15m(rem.id);
      } else if (index === 1) {
        // Complete
        this.completeReminder(rem.id);
      }
    });

    notif.show();
  }

  public snoozeReminder15m(id: string): void {
    const target = new Date(Date.now() + 15 * 60 * 1000);
    target.setSeconds(0, 0);
    this.ledger.snoozeReminder(id, target.toISOString());
    this.notifiedDueDates.delete(id); // Allow re-notification when due again
    this.syncEngine.triggerDebounced();
  }

  public completeReminder(id: string): void {
    this.ledger.completeReminder(id);
    this.notifiedDueDates.delete(id);
    this.syncEngine.triggerDebounced();
  }

  public clearNotified(id: string): void {
    this.notifiedDueDates.delete(id);
  }
}
