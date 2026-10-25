export interface CallTarget { name: string; phone: string | null }
export function getCallTarget(reminder: { title: string; notes?: string | null; tags?: string[] | null }): CallTarget | null {
  if (!/^(?:call|phone|ring)\b/i.test(reminder.title.trim()) && !reminder.tags?.includes('call')) return null;
  const name = reminder.title.replace(/^(?:call(?:\s+back)?|phone|ring)\s+(?:from\s+)?/i, '').trim() || 'contact';
  const candidates = (reminder.title + '\n' + (reminder.notes || '')).match(/\+?\d[\d ()-]{5,}\d/g) || [];
  for (const candidate of candidates) {
    if (/^\d{4}-\d{2}-\d{2}/.test(candidate.trim())) continue;
    const phone = candidate.replace(/[ ()-]/g, '');
    if (/^\+?\d{7,15}$/.test(phone)) return { name, phone };
  }
  return { name, phone: null };
}
