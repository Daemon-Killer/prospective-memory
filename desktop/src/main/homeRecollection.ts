import { Reminder, RecollectionCategory, RecollectionItem } from '../types';

/**
  * Desktop Home Recollection Engine
  * Automatically isolates domestic intentions (calls, groceries, chores)
  * captured during the workday when switching to or operating in Home context.
  */

export function categorizeRecollectionItem(reminder: Reminder): RecollectionCategory {
  const text = `${reminder.title} ${reminder.notes || ''}`.toLowerCase();
  const tags = reminder.tags?.map((t) => t.toLowerCase()) || [];

  // Communication / Callbacks
  if (
    tags.includes('call') ||
    tags.includes('calls') ||
    tags.includes('callback') ||
    /^(?:call|phone|ring|callback)\b/i.test(reminder.title.trim()) ||
    /\b(?:call|phone)\s+[a-zA-Z]/i.test(reminder.title) ||
    /\bforgot\s+to\s+call\b/i.test(text)
  ) {
    return 'call';
  }

  // Groceries / Errands / Items to bring
  if (
    tags.includes('grocery') ||
    tags.includes('groceries') ||
    tags.includes('errand') ||
    tags.includes('errands') ||
    /\b(buy|groceries|grocery|market|dahi|milk|bread|eggs|veggies|vegetables|fruits|paneer|supermarket|kirana|bring|pick\s*up)\b/i.test(
      text
    )
  ) {
    return 'grocery';
  }

  // Household Chores / Maintenance
  if (
    tags.includes('chore') ||
    tags.includes('chores') ||
    /\b(clean|wash|laundry|dishes|dishwasher|plants?|water|repair|fix|plumber|electrician|mechanic|trash|garbage|dust|cook|bake)\b/i.test(
      text
    )
  ) {
    return 'chore';
  }

  return 'general';
}

export function getRecollectionItems(reminders: Reminder[]): RecollectionItem[] {
  return reminders
    .filter((r) => {
      if (r.status === 'completed' || r.isDeleted) return false;
      // Exclude explicit work items
      if (
        r.context === 'work' ||
        r.tags?.some((t) => ['work', 'office', 'job'].includes(t.toLowerCase()))
      ) {
        return false;
      }
      return true;
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      category: categorizeRecollectionItem(r),
      dueDate: r.dueDate,
      notes: r.notes,
      tags: r.tags,
      reminder: r,
    }));
}
