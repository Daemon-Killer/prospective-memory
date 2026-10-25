import { describe, it, expect } from 'vitest';
import { categorizeRecollectionItem, getRecollectionItems } from '../src/main/homeRecollection';
import { Reminder } from '../src/types';

describe('Desktop Home Recollection Engine', () => {
  const baseTime = new Date('2026-09-29T10:00:00Z').toISOString();

  it('categorizes call and phone reminders', () => {
    const rem: Reminder = {
      id: 'c1',
      title: 'Call mom regarding dinner',
      dueDate: baseTime,
      status: 'pending',
      snoozeCount: 0,
      createdAt: baseTime,
      updatedAt: baseTime,
    };
    expect(categorizeRecollectionItem(rem)).toBe('call');

    const remWithTag: Reminder = {
      ...rem,
      title: 'Follow up with electrician',
      tags: ['call'],
    };
    expect(categorizeRecollectionItem(remWithTag)).toBe('call');
  });

  it('categorizes grocery and market items', () => {
    const rem: Reminder = {
      id: 'g1',
      title: 'Buy dahi and milk',
      dueDate: baseTime,
      status: 'pending',
      snoozeCount: 0,
      createdAt: baseTime,
      updatedAt: baseTime,
    };
    expect(categorizeRecollectionItem(rem)).toBe('grocery');

    const remWithTag: Reminder = {
      ...rem,
      title: 'Pick up fruits from market',
      tags: ['errand'],
    };
    expect(categorizeRecollectionItem(remWithTag)).toBe('grocery');
  });

  it('categorizes household chores and maintenance', () => {
    const rem: Reminder = {
      id: 'h1',
      title: 'Water plants and clean kitchen',
      dueDate: baseTime,
      status: 'pending',
      snoozeCount: 0,
      createdAt: baseTime,
      updatedAt: baseTime,
    };
    expect(categorizeRecollectionItem(rem)).toBe('chore');
  });

  it('filters out completed, deleted, and work items from recollection', () => {
    const reminders: Reminder[] = [
      {
        id: '1',
        title: 'Buy bread',
        dueDate: baseTime,
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
        context: 'home',
      },
      {
        id: '2',
        title: 'Call boss about PR',
        dueDate: baseTime,
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
        context: 'work',
      },
      {
        id: '3',
        title: 'Office sprint planning',
        dueDate: baseTime,
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
        tags: ['work'],
      },
      {
        id: '4',
        title: 'Fix kitchen sink',
        dueDate: baseTime,
        status: 'completed',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      },
      {
        id: '5',
        title: 'Clean balcony',
        dueDate: baseTime,
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
        isDeleted: true,
      },
      {
        id: '6',
        title: 'Order groceries online',
        dueDate: baseTime,
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      },
    ];

    const recollection = getRecollectionItems(reminders);
    expect(recollection).toHaveLength(2);
    expect(recollection.map((r) => r.id)).toEqual(['1', '6']);
  });
});
