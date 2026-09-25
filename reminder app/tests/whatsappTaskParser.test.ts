/**
 * Remy Reminders - WhatsApp & Family Chat Message Parsing Test Suite
 * 
 * Verifies:
 * 1. Conversational noise rejection (greetings, small talk, acknowledgments, media placeholders).
 * 2. Actionable errand detection in English & Hinglish ("dahi le aana aate waqt", "please bring milk", "lock the door", etc.).
 * 3. Title cleaning (stripping polite prefixes and group sender prefixes).
 * 4. Sender attribution & sourceAppName generation ("Mummy · WhatsApp", "Papa · WhatsApp").
 * 5. Conversational time cue extraction in dateExtractor ("shaam ko", "tonight", "kal subah", "aate waqt", "N baje", generic errand default).
 * 6. Strict security quarantine preservation (OTPs remain quarantined).
 * 7. SensoryInboxShelf & SensoryStorageService integration (badge display, note rendering, zero orphaned state).
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;

import {
  classifyNotification,
  checkNoise,
  checkQuarantine,
  extractDate,
  extractChatSenderAndMessage,
  isChatNoise,
  isActionableChatMessage,
  cleanChatTaskTitle,
  extractChatActionVerb,
  parseActionableChatMessage,
  RawNotificationPayload,
  SensoryStorageService,
  SensorySuggestion,
} from '../src/sensory';
import {
  SensoryInboxShelf,
  cleanPackageBadge,
} from '../src/components/SensoryInboxShelf';
import { ThemeProvider } from '../src/theme/ThemeContext';

describe('WhatsApp & Family Chat Task Parser', () => {
  // Use 10:00 AM on Monday, Sept 14, 2026 as standard reference time
  const baseNow = new Date(2026, 8, 14, 10, 0, 0);

  // =========================================================================
  // 1. Conversational Noise Rejection
  // =========================================================================
  describe('Conversational Noise Rejection', () => {
    test.each([
      ['good morning', 'Good morning greeting'],
      ['good night', 'Good night greeting'],
      ['gm', 'Short greeting'],
      ['kahan ho', 'Where are you Hinglish small talk'],
      ['kaha ho?', 'Question small talk'],
      ['kidhar ho', 'Where are you variation'],
      ['where are you', 'English small talk'],
      ['kya kar rahe ho', 'What are you doing Hinglish'],
      ['what are you doing', 'What are you doing English'],
      ['sab theek', 'Small talk check'],
      ['kaise ho', 'How are you Hinglish'],
      ['hi', 'Casual greeting'],
      ['hello', 'Casual greeting'],
      ['namaste', 'Indian greeting'],
      ['radhe radhe', 'Indian greeting'],
      ['ok', 'Single word acknowledgment'],
      ['okay', 'Single word acknowledgment'],
      ['theek hai', 'Hinglish acknowledgment'],
      ['thik hai', 'Hinglish acknowledgment'],
      ['achha', 'Hinglish acknowledgment'],
      ['haa', 'Hinglish yes'],
      ['yes', 'English yes'],
      ['no', 'English no'],
      ['done', 'Single word done'],
      ['noted', 'Single word noted'],
      ['sure', 'Single word sure'],
      ['cool', 'Single word cool'],
      ['perfect', 'Single word perfect'],
      ['bye', 'Single word bye'],
      ['tata', 'Single word tata'],
      ['👍', 'Single emoji reaction'],
      ['❤️', 'Single emoji reaction'],
      ['🙏', 'Single emoji reaction'],
      ['ok 👍', 'Acknowledgment with emoji'],
      ['theek hai ji 🙏', 'Acknowledgment with emoji'],
      ['📷 Photo', 'WhatsApp photo placeholder'],
      ['Photo', 'Photo placeholder'],
      ['🎤 Voice message', 'WhatsApp voice message placeholder'],
      ['Voice message (0:15)', 'Voice message placeholder with duration'],
      ['📹 Video', 'Video placeholder'],
      ['Sticker', 'Sticker placeholder'],
      ['GIF', 'GIF placeholder'],
    ])('discards "%s" as conversational noise (%s)', (text) => {
      const payload: RawNotificationPayload = {
        id: `noise-${Math.random()}`,
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text,
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('chat');
    });

    test('isChatNoise correctly identifies noise strings', () => {
      expect(isChatNoise('good morning')).toBe(true);
      expect(isChatNoise('kahan ho')).toBe(true);
      expect(isChatNoise('ok')).toBe(true);
      expect(isChatNoise('theek hai')).toBe(true);
      expect(isChatNoise('📷 Photo')).toBe(true);
      expect(isChatNoise('🎤 Voice message')).toBe(true);
      expect(isChatNoise('👍')).toBe(true);
      expect(isChatNoise('dahi le aana aate waqt')).toBe(false);
      expect(isChatNoise('please bring milk')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Actionable Errands in English & Hinglish
  // =========================================================================
  describe('Actionable Errands Detection', () => {
    test('1. "dahi le aana aate waqt" from Mummy', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-1',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'dahi le aana aate waqt',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable).toBeDefined();
      expect(result.actionable?.title).toBe('Dahi le aana aate waqt');
      expect(result.actionable?.actionVerb).toBe('Bring');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.armed).toBe(true);

      const due = new Date(result.actionable!.inferredDueDate);
      expect(due.getHours()).toBe(18);
      expect(due.getMinutes()).toBe(30);
    });

    test('2. "please bring milk" from Mummy (clean title stripping polite prefix)', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-2',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'please bring milk',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Bring milk');
      expect(result.actionable?.actionVerb).toBe('Bring');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.armed).toBe(true);

      // Generic errand defaults to today 19:00
      const due = new Date(result.actionable!.inferredDueDate);
      expect(due.getHours()).toBe(19);
      expect(due.getMinutes()).toBe(0);
    });

    test('3. "call uncle tomorrow" from Papa', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-3',
        packageName: 'com.whatsapp',
        title: 'Papa',
        text: 'call uncle tomorrow',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Call uncle tomorrow');
      expect(result.actionable?.actionVerb).toBe('Call');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.context).toBe('WhatsApp message from Papa');
      expect(result.actionable?.sourceAppName).toBe('Papa · WhatsApp');
      expect(result.actionable?.armed).toBe(true);

      const due = new Date(result.actionable!.inferredDueDate);
      expect(due.getDate()).toBe(baseNow.getDate() + 1);
      expect(due.getHours()).toBe(9);
    });

    test('4. "medicine le lena 8 baje" from Mummy', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-4',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'medicine le lena 8 baje',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Medicine le lena 8 baje');
      expect(result.actionable?.actionVerb).toBe('Take');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.armed).toBe(true);

      const due = new Date(result.actionable!.inferredDueDate);
      expect(due.getHours()).toBe(8);
      expect(due.getMinutes()).toBe(0);
    });

    test('5. "pay electricity bill tonight" from Mummy', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-5',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'pay electricity bill tonight',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Pay electricity bill tonight');
      expect(result.actionable?.actionVerb).toBe('Pay');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.armed).toBe(true);

      const due = new Date(result.actionable!.inferredDueDate);
      expect(due.getHours()).toBe(21);
      expect(due.getMinutes()).toBe(0);
    });

    test('6. "lock the door" from Papa', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-6',
        packageName: 'com.whatsapp',
        title: 'Papa',
        text: 'lock the door',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Lock the door');
      expect(result.actionable?.actionVerb).toBe('Lock');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
      expect(result.actionable?.sourceAppName).toBe('Papa · WhatsApp');
      expect(result.actionable?.armed).toBe(true);
    });

      test('7. "500 rs transfer kar do" from Priya (non-family contact)', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-7',
        packageName: 'com.whatsapp',
        title: 'Priya',
        text: '500 rs transfer kar do',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('500 rs transfer kar do');
      expect(result.actionable?.actionVerb).toBe('Transfer');
      expect(result.actionable?.category).toBe('personal');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'chat']);
      expect(result.actionable?.context).toBe('WhatsApp message from Priya');
      expect(result.actionable?.sourceAppName).toBe('Priya · WhatsApp');
      expect(result.actionable?.armed).toBe(true);
    });

    test('8. Hinglish errand variants: "dahi leke aana", "dahi le ana", "doodh mangwa lena"', () => {
      expect(isActionableChatMessage('Mummy', 'dahi leke aana aate waqt')).toBe(true);
      expect(isActionableChatMessage('Mummy', 'dahi le ana aate waqt')).toBe(true);
      expect(isActionableChatMessage('Mummy', 'doodh mangwa lena')).toBe(true);
      expect(isActionableChatMessage('Papa', 'gate lock kar dena')).toBe(true);
      expect(isActionableChatMessage('Papa', 'kundi laga dena')).toBe(true);
    });
  });

  // =========================================================================
  // 3. Sender Extraction & Group Notifications
  // =========================================================================
  describe('Sender Extraction & Group Notifications', () => {
    test('extracts sender from group chat with inline text prefix "Mummy: dahi le aana aate waqt"', () => {
      const payload: RawNotificationPayload = {
        id: 'grp-1',
        packageName: 'com.whatsapp',
        title: 'Sharma Parivar',
        text: 'Mummy: dahi le aana aate waqt',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Dahi le aana aate waqt');
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
    });

    test('extracts sender with custom emojis "✨Mummy✨: dahi le aana aate waqt"', () => {
      const payload: RawNotificationPayload = {
        id: 'grp-emoji-1',
        packageName: 'com.whatsapp',
        title: 'Sharma Parivar',
        text: '✨Mummy✨: dahi le aana aate waqt',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Dahi le aana aate waqt');
      expect(result.actionable?.sourceAppName).toBe('✨Mummy✨ · WhatsApp');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
    });

    test('extracts sender with title/dots "Dr. Sharma: medicine le lena 8 baje"', () => {
      const payload: RawNotificationPayload = {
        id: 'grp-doc-1',
        packageName: 'com.whatsapp',
        title: 'Society Group',
        text: 'Dr. Sharma: medicine le lena 8 baje',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.title).toBe('Medicine le lena 8 baje');
      expect(result.actionable?.sourceAppName).toBe('Dr. Sharma · WhatsApp');
    });

    test('extracts sender from title formatted as "Group Name: Sender"', () => {
      const payload: RawNotificationPayload = {
        id: 'grp-title-colon',
        packageName: 'com.whatsapp',
        title: 'Sharma Parivar: Mummy',
        text: 'dahi le aana aate waqt',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.tags).toEqual(['whatsapp', 'family']);
    });

    test('retains sender Mummy when 1-on-1 text starts with prefix label "Urgent: please bring milk"', () => {
      const payload: RawNotificationPayload = {
        id: 'wa-urgent-1',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'Urgent: please bring milk',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.sourceAppName).toBe('Mummy · WhatsApp');
      expect(result.actionable?.context).toBe('WhatsApp message from Mummy');
      expect(result.actionable?.title).toBe('Bring milk');
    });

    test('cleans message count suffix from title "Papa (3 messages)"', () => {
      const payload: RawNotificationPayload = {
        id: 'grp-2',
        packageName: 'com.whatsapp',
        title: 'Papa (3 messages)',
        text: 'lock the door',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.sourceAppName).toBe('Papa · WhatsApp');
      expect(result.actionable?.context).toBe('WhatsApp message from Papa');
    });

    test('extractChatSenderAndMessage helper behavior', () => {
      const res1 = extractChatSenderAndMessage('Family Group', 'Papa: door band kar dena');
      expect(res1.sender).toBe('Papa');
      expect(res1.message).toBe('door band kar dena');
      expect(res1.isGroup).toBe(true);

      const res2 = extractChatSenderAndMessage('Mummy (2 new messages)', 'please bring milk');
      expect(res2.sender).toBe('Mummy');
      expect(res2.message).toBe('please bring milk');
      expect(res2.isGroup).toBe(false);

      const res3 = extractChatSenderAndMessage('WhatsApp', 'Rohan: call me');
      expect(res3.sender).toBe('Rohan');
      expect(res3.message).toBe('call me');

      const res4 = extractChatSenderAndMessage('Sharma Parivar: Mummy', 'dahi le aana');
      expect(res4.sender).toBe('Mummy');
      expect(res4.isGroup).toBe(true);

      const res5 = extractChatSenderAndMessage('Mummy', 'Urgent: pay electricity bill tonight');
      expect(res5.sender).toBe('Mummy');
      expect(res5.isGroup).toBe(false);
    });

    test('cleanChatTaskTitle strips polite openers, greetings and vocatives repeatedly', () => {
      expect(cleanChatTaskTitle('please bring milk')).toBe('Bring milk');
      expect(cleanChatTaskTitle('Pls call uncle tomorrow')).toBe('Call uncle tomorrow');
      expect(cleanChatTaskTitle('Can you please lock the door?')).toBe('Lock the door');
      expect(cleanChatTaskTitle('yaad se medicine le lena 8 baje')).toBe('Medicine le lena 8 baje');
      expect(cleanChatTaskTitle('ek baar switch off kar dena motor')).toBe('Switch off kar dena motor');
      expect(cleanChatTaskTitle('Good morning! Please bring milk')).toBe('Bring milk');
      expect(cleanChatTaskTitle('Beta, dahi le aana aate waqt')).toBe('Dahi le aana aate waqt');
      expect(cleanChatTaskTitle('Bhaiya, 500 rs transfer kar do')).toBe('500 rs transfer kar do');
      expect(cleanChatTaskTitle('Urgent: pay electricity bill tonight')).toBe('Pay electricity bill tonight');
      expect(cleanChatTaskTitle('Hi, call uncle tomorrow')).toBe('Call uncle tomorrow');
    });
  });

  // =========================================================================
  // 4. Conversational Time Extraction (dateExtractor.ts)
  // =========================================================================
  describe('Conversational Time Extraction', () => {
    test('"shaam ko" / "this evening" sets 19:00 today', () => {
      const res1 = extractDate('shaam ko medicine le lena', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getHours()).toBe(19);
      expect(res1.date.getMinutes()).toBe(0);

      const res2 = extractDate('pick up laundry this evening', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getHours()).toBe(19);
      expect(res2.date.getMinutes()).toBe(0);

      const res3 = extractDate('shaam me dahi le aana', baseNow);
      expect(res3.armed).toBe(true);
      expect(res3.date.getHours()).toBe(19);

      const res4 = extractDate('in the evening please call uncle', baseNow);
      expect(res4.armed).toBe(true);
      expect(res4.date.getHours()).toBe(19);
    });

    test('"tonight" / "raat ko" sets 21:00 today', () => {
      const res1 = extractDate('pay electricity bill tonight', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getHours()).toBe(21);
      expect(res1.date.getMinutes()).toBe(0);

      const res2 = extractDate('raat ko call karna', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getHours()).toBe(21);
      expect(res2.date.getMinutes()).toBe(0);

      const res3 = extractDate('raat me message kar dena', baseNow);
      expect(res3.armed).toBe(true);
      expect(res3.date.getHours()).toBe(21);
    });

    test('"kal subah" / "tomorrow morning" sets 09:00 tomorrow', () => {
      const res1 = extractDate('kal subah dahi le aana', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getDate()).toBe(baseNow.getDate() + 1);
      expect(res1.date.getHours()).toBe(9);
      expect(res1.date.getMinutes()).toBe(0);

      const res2 = extractDate('call dentist tomorrow morning', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getDate()).toBe(baseNow.getDate() + 1);
      expect(res2.date.getHours()).toBe(9);
    });

    test('"aate waqt" / "while coming" sets 18:30 today', () => {
      const res1 = extractDate('dahi le aana aate waqt', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getHours()).toBe(18);
      expect(res1.date.getMinutes()).toBe(30);

      const res2 = extractDate('buy milk while coming', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getHours()).toBe(18);
      expect(res2.date.getMinutes()).toBe(30);

      const res3 = extractDate('bring milk on the way back', baseNow);
      expect(res3.armed).toBe(true);
      expect(res3.date.getHours()).toBe(18);
      expect(res3.date.getMinutes()).toBe(30);
    });

    test('"aate waqt" after 18:30 offsets by +2 hours', () => {
      const eveningTime = new Date(2026, 8, 14, 19, 0, 0); // 19:00
      const res = extractDate('dahi le aana aate waqt', eveningTime);
      expect(res.armed).toBe(true);
      expect(res.date.getTime()).toBe(eveningTime.getTime() + 2 * 3600 * 1000);
    });

    test('"N baje" sets N:00 clock time and handles periods with "ko"', () => {
      const res1 = extractDate('medicine le lena 8 baje', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getHours()).toBe(8);
      expect(res1.date.getMinutes()).toBe(0);

      const res2 = extractDate('shaam 6 baje call karna', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getHours()).toBe(18);
      expect(res2.date.getMinutes()).toBe(0);

      // "shaam ko 8 baje" correctly detects evening period despite "ko"
      const res3 = extractDate('shaam ko 8 baje medicine le lena', baseNow);
      expect(res3.armed).toBe(true);
      expect(res3.date.getHours()).toBe(20);
      expect(res3.date.getMinutes()).toBe(0);
      expect(res3.date.getDate()).toBe(baseNow.getDate());

      // "raat ko 9 baje"
      const res4 = extractDate('raat ko 9 baje phone karna', baseNow);
      expect(res4.armed).toBe(true);
      expect(res4.date.getHours()).toBe(21);

      // "dopahar ko 2 baje"
      const res5 = extractDate('dopahar ko 2 baje aana', baseNow);
      expect(res5.armed).toBe(true);
      expect(res5.date.getHours()).toBe(14);

      // "kal shaam ko 8 baje"
      const res6 = extractDate('kal shaam ko 8 baje milte hain', baseNow);
      expect(res6.armed).toBe(true);
      expect(res6.date.getHours()).toBe(20);
      expect(res6.date.getDate()).toBe(baseNow.getDate() + 1);
    });

    test('Generic errand with no time defaults to today 19:00 with armed: true', () => {
      const res1 = extractDate('please bring milk', baseNow);
      expect(res1.armed).toBe(true);
      expect(res1.date.getHours()).toBe(19);
      expect(res1.date.getMinutes()).toBe(0);

      const res2 = extractDate('lock the door', baseNow);
      expect(res2.armed).toBe(true);
      expect(res2.date.getHours()).toBe(19);

      const res3 = extractDate('500 rs transfer kar do', baseNow);
      expect(res3.armed).toBe(true);
      expect(res3.date.getHours()).toBe(19);
    });
  });

  // =========================================================================
  // 5. Strict Security Quarantine Gate Preservation
  // =========================================================================
  describe('Security Quarantine Preservation', () => {
    test('strictly quarantines WhatsApp message containing OTP', () => {
      const payload: RawNotificationPayload = {
        id: 'sec-1',
        packageName: 'com.whatsapp',
        title: 'WhatsApp',
        text: 'Your WhatsApp code is 492810. Do not share this code with anyone.',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.actionable).toBeUndefined();
    });

    test('strictly quarantines forwarded bank transaction OTP from family contact', () => {
      const payload: RawNotificationPayload = {
        id: 'sec-2',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'Dear customer, 738291 is your OTP for transaction of Rs 5000 at Amazon.',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
    });

    test('strictly quarantines security verification PIN', () => {
      const payload: RawNotificationPayload = {
        id: 'sec-3',
        packageName: 'com.whatsapp',
        title: 'Papa',
        text: 'Use security pin: 991823 to verify account',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const result = classifyNotification(payload, baseNow);
      expect(result.stream).toBe('quarantined');
    });
  });

  // =========================================================================
  // 6. UI Badge Normalization & Note Display (SensoryInboxShelf)
  // =========================================================================
  describe('SensoryInboxShelf UI & Storage Integration', () => {
    test('cleanPackageBadge displays [MUMMY · WHATSAPP] or [PAPA · WHATSAPP]', () => {
      expect(cleanPackageBadge('com.whatsapp', 'Mummy · WhatsApp')).toBe('MUMMY · WHATSAPP');
      expect(cleanPackageBadge('com.whatsapp', 'Papa · WhatsApp')).toBe('PAPA · WHATSAPP');
      expect(cleanPackageBadge('com.whatsapp', 'Priya · WhatsApp')).toBe('PRIYA · WHATSAPP');
      expect(cleanPackageBadge('com.whatsapp', 'Mummy')).toBe('MUMMY · WHATSAPP');
      expect(cleanPackageBadge('com.whatsapp.w4b', 'Papa')).toBe('PAPA · WHATSAPP');
      expect(cleanPackageBadge('org.telegram.messenger', 'Mummy')).toBe('MUMMY · TELEGRAM');
      expect(cleanPackageBadge('com.whatsapp', '✨Mummy✨ · WhatsApp')).toBe('✨MUMMY✨ · WHATSAPP');
    });

    test('renders suggestion card with sender badge and note text', async () => {
      const testSuggestions: SensorySuggestion[] = [
        {
          id: 'sug-wa-1',
          title: 'Dahi le aana aate waqt',
          actionVerb: 'Bring',
          originalText: 'dahi le aana aate waqt',
          notes: 'dahi le aana aate waqt',
          inferredDueDate: '2026-09-14T18:30:00.000Z',
          armed: true,
          sourcePackage: 'com.whatsapp',
          sourceAppName: 'Mummy · WhatsApp',
          category: 'personal',
          confidence: 0.95,
          tags: ['whatsapp', 'family'],
          createdAt: baseNow.toISOString(),
          status: 'pending',
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(
            ThemeProvider as any,
            { initialMode: 'void' },
            React.createElement(SensoryInboxShelf, {
              suggestions: testSuggestions,
              onAccept: jest.fn(),
              onDismiss: jest.fn(),
              currentTime: baseNow,
            })
          )
        );
      });

      const root = renderer.root;
      const sourceBadge = root.findByProps({ testID: 'suggestion-source-sug-wa-1' });
      expect(sourceBadge.props.children).toBe('MUMMY · WHATSAPP');

      const titleNode = root.findByProps({ testID: 'suggestion-title-sug-wa-1' });
      expect(titleNode.props.children).toBe('Dahi le aana aate waqt');

      const noteNode = root.findByProps({ testID: 'suggestion-note-sug-wa-1' });
      expect(noteNode.props.children).toBe('dahi le aana aate waqt');

      act(() => {
        renderer.unmount();
      });
    });

    test('SensoryStorageService.addFromExtraction retains sourceAppName and notes', async () => {
      const mockRepo: any = { create: jest.fn().mockResolvedValue({ id: 'rem-1' }) };
      const mockNotif: any = { scheduleReminderNotification: jest.fn().mockResolvedValue('notif-1') };
      const storage = new SensoryStorageService(mockRepo, mockNotif, '@remy/test_wa_storage');

      const extraction = {
        title: 'Bring milk',
        actionVerb: 'Bring',
        context: 'WhatsApp message from Mummy',
        inferredDueDate: '2026-09-14T19:00:00.000Z',
        armed: true,
        category: 'personal' as const,
        tags: ['whatsapp', 'family'],
        confidence: 0.95,
        notes: 'please bring milk',
        sourceAppName: 'Mummy · WhatsApp',
      };

      const raw: RawNotificationPayload = {
        id: 'raw-wa-1',
        packageName: 'com.whatsapp',
        title: 'Mummy',
        text: 'please bring milk',
        timestamp: baseNow.getTime(),
        postTime: baseNow.getTime(),
      };

      const suggestion = await storage.addFromExtraction(extraction, raw);
      expect(suggestion.sourceAppName).toBe('Mummy · WhatsApp');
      expect(suggestion.notes).toBe('please bring milk');
      expect(suggestion.title).toBe('Bring milk');

      const pending = storage.getPendingSuggestions();
      expect(pending).toHaveLength(1);
      expect(pending[0].sourceAppName).toBe('Mummy · WhatsApp');

      await storage.clear();
    });
  });
});
