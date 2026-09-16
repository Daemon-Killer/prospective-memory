/**
 * Remy Reminders - Watchlist Parser & Weekend Surfacing Test Suite
 * Verification for Option 1: Movie & Cultural Recommendations Ledger
 */

import {
  parseCulturalCapture,
  getWeekendWatchlistCue,
  formatCulturalBadge,
} from '../src/utils/watchlistParser';
import { Reminder } from '../src/types/reminder';

describe('Watchlist Parser & Cultural Recommendation Engine', () => {
  describe('parseCulturalCapture', () => {
    it('extracts movie with year, platform, and runtime', () => {
      const input = 'Dune: Part Two (2024) [Max] 166 min #scifi';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('movie');
      expect(parsed.metadata.platform).toBe('Max');
      expect(parsed.metadata.releaseYear).toBe(2024);
      expect(parsed.metadata.runtime).toBe('166 min');
      expect(parsed.metadata.genres).toContain('scifi');
      expect(parsed.title).toContain('Dune: Part Two');
    });

    it('extracts show with season and platform', () => {
      const input = 'Severance Season 2 on Apple TV+';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('show');
      expect(parsed.metadata.platform).toBe('Apple TV');
      expect(parsed.title).toContain('Severance');
    });

    it('extracts documentary with duration in hours and minutes', () => {
      const input = 'Jiro Dreams of Sushi doc 1h 21m on Netflix rec by Sarah';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('documentary');
      expect(parsed.metadata.platform).toBe('Netflix');
      expect(parsed.metadata.runtime).toBe('1h 21m');
      expect(parsed.metadata.recommendedBy).toBe('Sarah');
      expect(parsed.title).toContain('Jiro Dreams of Sushi');
    });

    it('extracts book and recommender', () => {
      const input = 'Read Neuromancer book by William Gibson from Alice #cyberpunk';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('book');
      expect(parsed.metadata.recommendedBy).toBe('Alice');
      expect(parsed.metadata.genres).toContain('cyberpunk');
      expect(parsed.title).toContain('Neuromancer');
    });

    it('extracts podcast with platform and runtime in minutes', () => {
      const input = 'Hardcore History podcast 240m on Spotify';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('other');
      expect(parsed.metadata.platform).toBe('Spotify');
      expect(parsed.metadata.runtime).toBe('240m');
    });

    it('extracts music album with year', () => {
      const input = 'Random Access Memories album (2013) on Spotify';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.mediaType).toBe('other');
      expect(parsed.metadata.releaseYear).toBe(2013);
      expect(parsed.metadata.platform).toBe('Spotify');
    });

    it('handles explicit media type fallback/override', () => {
      const input = 'Oppenheimer 180 min';
      const parsed = parseCulturalCapture(input, 'movie');

      expect(parsed.metadata.mediaType).toBe('movie');
      expect(parsed.metadata.runtime).toBe('180 min');
      expect(parsed.title).toContain('Oppenheimer');
    });

    it('handles plain text title without metadata gracefully', () => {
      const input = 'Inception';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('Inception');
      expect(parsed.metadata.mediaType).toBe('movie');
      expect(parsed.metadata.platform).toBeNull();
      expect(parsed.metadata.releaseYear).toBeNull();
    });

    it('cleans recommender prefixes properly', () => {
      const rec1 = parseCulturalCapture('Chinatown via Bob');
      expect(rec1.metadata.recommendedBy).toBe('Bob');

      const rec2 = parseCulturalCapture('Heat recommended by Charlie');
      expect(rec2.metadata.recommendedBy).toBe('Charlie');

      const rec3 = parseCulturalCapture('Solaris from Dave');
      expect(rec3.metadata.recommendedBy).toBe('Dave');
    });

    it('extracts multiple tags', () => {
      const input = 'Blade Runner 2049 #cyberpunk #neon #noir';
      const parsed = parseCulturalCapture(input);

      expect(parsed.metadata.genres).toEqual(expect.arrayContaining(['cyberpunk', 'neon', 'noir']));
      expect(parsed.title).toBe('Blade Runner 2049');
      expect(parsed.metadata.releaseYear).toBeNull();
    });

    it('disambiguates title containing a year from parenthesized release year (e.g. 1917)', () => {
      const input = '1917 (2019) on Netflix';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('1917');
      expect(parsed.metadata.releaseYear).toBe(2019);
      expect(parsed.metadata.platform).toBe('Netflix');
      expect(parsed.metadata.mediaType).toBe('movie');
    });

    it('disambiguates leading numeric classic titles like 2001: A Space Odyssey', () => {
      const input = '2001: A Space Odyssey (1968)';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('2001: A Space Odyssey');
      expect(parsed.metadata.releaseYear).toBe(1968);
    });

    it('preserves leading numeric title without release year', () => {
      const input = '1917 on Netflix';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('1917');
      expect(parsed.metadata.releaseYear).toBeNull();
      expect(parsed.metadata.platform).toBe('Netflix');
    });

    it('does not misidentify titles starting with "From" as recommenders', () => {
      const input = 'From Dusk Till Dawn on Netflix';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('From Dusk Till Dawn');
      expect(parsed.metadata.recommendedBy).toBeNull();
      expect(parsed.metadata.platform).toBe('Netflix');
    });

    it('extracts multi-line capture with dedicated notes and tags', () => {
      const input = '1917 (2019)\nA gripping World War I film\nrec by Alex on Netflix #drama';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('1917');
      expect(parsed.notes).toBe('A gripping World War I film');
      expect(parsed.metadata.releaseYear).toBe(2019);
      expect(parsed.metadata.platform).toBe('Netflix');
      expect(parsed.metadata.recommendedBy).toBe('Alex');
      expect(parsed.metadata.genres).toContain('drama');
    });

    it('extracts creator/director without wrongly converting movies to books', () => {
      const input = 'Oppenheimer dir by Christopher Nolan 180m';
      const parsed = parseCulturalCapture(input, 'movie');

      expect(parsed.title).toBe('Oppenheimer');
      expect(parsed.metadata.mediaType).toBe('movie');
      expect(parsed.metadata.creator).toBe('Christopher Nolan');
      expect(parsed.metadata.runtime).toBe('180m');
    });

    it('extracts author as creator for books', () => {
      const input = 'Neuromancer book by William Gibson';
      const parsed = parseCulturalCapture(input);

      expect(parsed.title).toBe('Neuromancer');
      expect(parsed.metadata.mediaType).toBe('book');
      expect(parsed.metadata.creator).toBe('William Gibson');
    });
  });

  describe('formatCulturalBadge', () => {
    it('formats full metadata into Swiss monospace string', () => {
      const badge = formatCulturalBadge({
        mediaType: 'movie',
        platform: 'Netflix',
        releaseYear: 2024,
        runtime: '148 min',
      });

      expect(badge).toBe('MOVIE · NETFLIX · 2024 · 148 MIN');
    });

    it('formats minimal metadata into Swiss monospace string', () => {
      const badge = formatCulturalBadge({
        mediaType: 'show',
      });

      expect(badge).toBe('SHOW');
    });

    it('formats partial metadata correctly', () => {
      const badge = formatCulturalBadge({
        mediaType: 'book',
        recommendedBy: 'Elena',
      });

      expect(badge).toBe('BOOK · VIA ELENA');
    });
  });

  describe('getWeekendWatchlistCue', () => {
    const makeMockReminder = (id: string, title: string, completed: boolean = false): Reminder => ({
      id,
      title,
      dueDate: new Date().toISOString(),
      status: completed ? 'completed' : 'pending',
      snoozeCount: 0,
      culturalMetadata: {
        mediaType: 'movie',
        platform: 'Criterion',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const mockReminders: Reminder[] = [
      makeMockReminder('1', 'Stalker', false),
      makeMockReminder('2', 'Mirror', false),
      makeMockReminder('3', 'Solaris', true), // completed
    ];

    it('activates during Friday evening (after 15:00)', () => {
      // Friday Sep 11, 2026 19:00
      const fridayEvening = new Date(2026, 8, 11, 19, 0, 0);
      const cue = getWeekendWatchlistCue(mockReminders, fridayEvening);

      expect(cue.isWeekendCueActive).toBe(true);
      expect(cue.count).toBe(2);
      expect(cue.subtext).toContain('2 items queued for the weekend');
    });

    it('does not activate Friday before 15:00', () => {
      // Friday Sep 11, 2026 11:00
      const fridayMorning = new Date(2026, 8, 11, 11, 0, 0);
      const cue = getWeekendWatchlistCue(mockReminders, fridayMorning);

      expect(cue.isWeekendCueActive).toBe(false);
    });

    it('activates during Saturday all day', () => {
      // Saturday Sep 12, 2026 14:30
      const saturday = new Date(2026, 8, 12, 14, 30, 0);
      const cue = getWeekendWatchlistCue(mockReminders, saturday);

      expect(cue.isWeekendCueActive).toBe(true);
      expect(cue.count).toBe(2);
    });

    it('activates during Sunday before 23:00', () => {
      // Sunday Sep 13, 2026 21:15
      const sundayNight = new Date(2026, 8, 13, 21, 15, 0);
      const cue = getWeekendWatchlistCue(mockReminders, sundayNight);

      expect(cue.isWeekendCueActive).toBe(true);
      expect(cue.count).toBe(2);
    });

    it('deactivates Sunday after 23:00', () => {
      // Sunday Sep 13, 2026 23:30
      const lateSunday = new Date(2026, 8, 13, 23, 30, 0);
      const cue = getWeekendWatchlistCue(mockReminders, lateSunday);

      expect(cue.isWeekendCueActive).toBe(false);
    });

    it('deactivates during weekdays (Monday to Thursday)', () => {
      // Tuesday Sep 15, 2026 20:00
      const tuesday = new Date(2026, 8, 15, 20, 0, 0);
      const cue = getWeekendWatchlistCue(mockReminders, tuesday);

      expect(cue.isWeekendCueActive).toBe(false);
      expect(cue.count).toBe(2);
    });

    it('handles empty watchlist during weekend gracefully', () => {
      const fridayNight = new Date(2026, 8, 11, 20, 0, 0);
      const cue = getWeekendWatchlistCue([], fridayNight);

      expect(cue.isWeekendCueActive).toBe(false);
      expect(cue.count).toBe(0);
    });
  });
});
