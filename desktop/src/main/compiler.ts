import crypto from 'crypto';
import {
  compileCapture,
  compileCaptureWithIntent,
  expandLingo,
  DEFAULT_LINGO,
  CaptureDraft,
} from '@core/captureCompilerCore';
import { Reminder } from '../types';

export { compileCapture, compileCaptureWithIntent, expandLingo, DEFAULT_LINGO };

export function compileToReminder(rawText: string): { reminder: Reminder; draft: CaptureDraft } {
  const draft = compileCaptureWithIntent(rawText);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const reminder: Reminder = {
    id,
    title: draft.title,
    notes: draft.raw !== draft.title ? draft.raw : null,
    dueDate: draft.dueDate.toISOString(),
    status: 'pending',
    snoozeCount: 0,
    createdAt: now,
    updatedAt: now,
    armed: draft.armed !== false,
  };

  return { reminder, draft };
}
