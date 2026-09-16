/**
 * Remy Reminders - WatchlistScreen Unit & Interaction Test Suite
 * Verification for Option 1: Movie & Cultural Recommendations Ledger
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;

import { WatchlistScreen } from '../src/screens/WatchlistScreen';
import { Reminder } from '../src/types/reminder';
import { darkColors } from '../src/theme/colors';

describe('WatchlistScreen Component Suite', () => {
  const mockReminders: Reminder[] = [
    {
      id: 'item-1',
      title: 'Dune: Part Two',
      dueDate: '2026-09-18T20:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      culturalMetadata: {
        mediaType: 'movie',
        platform: 'Max',
        releaseYear: 2024,
        runtime: '166 min',
        genres: ['scifi'],
      },
    },
    {
      id: 'item-2',
      title: 'Severance Season 2',
      dueDate: '2026-09-18T21:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-16T11:00:00.000Z',
      updatedAt: '2026-09-16T11:00:00.000Z',
      culturalMetadata: {
        mediaType: 'show',
        platform: 'Apple TV',
      },
    },
    {
      id: 'item-3',
      title: 'Neuromancer',
      dueDate: '2026-09-19T10:00:00.000Z',
      status: 'completed',
      snoozeCount: 0,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-16T09:00:00.000Z',
      culturalMetadata: {
        mediaType: 'book',
        recommendedBy: 'Alice',
      },
    },
    {
      id: 'item-4',
      title: 'Jiro Dreams of Sushi',
      dueDate: '2026-09-19T20:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-16T12:00:00.000Z',
      culturalMetadata: {
        mediaType: 'documentary',
        platform: 'Netflix',
        runtime: '81 min',
      },
    },
    {
      id: 'item-5',
      title: 'Pay electricity bill',
      dueDate: '2026-09-17T12:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-16T08:00:00.000Z',
      updatedAt: '2026-09-16T08:00:00.000Z',
      // No culturalMetadata: should not appear on watchlist
    },
  ];

  const defaultProps = {
    reminders: mockReminders,
    themeColors: darkColors,
    onCreateCulturalItem: jest.fn(),
    onToggleComplete: jest.fn(),
    onDeleteReminder: jest.fn(),
    onSnoozeReminder: jest.fn(),
    onClose: jest.fn(),
  };

  let currentRenderer: any = null;

  const renderScreen = (props = defaultProps) => {
    act(() => {
      currentRenderer = ReactTestRenderer.create(<WatchlistScreen {...props} />);
    });
    return currentRenderer;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (currentRenderer) {
      act(() => {
        currentRenderer.unmount();
      });
      currentRenderer = null;
    }
  });

  it('renders correctly with Swiss Void styling when mounted', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    expect(root.findByProps({ testID: 'watchlist-screen' })).toBeTruthy();
    expect(root.findByProps({ testID: 'watchlist-header-title' })).toBeTruthy();
    expect(root.findByProps({ testID: 'watchlist-close-btn' })).toBeTruthy();
    expect(root.findByProps({ testID: 'watchlist-input' })).toBeTruthy();
  });

  it('filters items by media type tab', () => {
    const renderer = renderScreen();
    const root = renderer.root;

    // Default 'all' tab shows all 4 cultural items
    const flatList = root.findByProps({ testID: 'watchlist-items-list' });
    expect(flatList.props.data.length).toBe(4);

    // Switch to MOVIES tab
    const movieTab = root.findByProps({ testID: 'watchlist-tab-movie' });
    act(() => {
      movieTab.props.onPress();
    });
    expect(flatList.props.data.length).toBe(1);
    expect(flatList.props.data[0].title).toBe('Dune: Part Two');

    // Switch to SHOWS tab
    const showTab = root.findByProps({ testID: 'watchlist-tab-show' });
    act(() => {
      showTab.props.onPress();
    });
    expect(flatList.props.data.length).toBe(1);
    expect(flatList.props.data[0].title).toBe('Severance Season 2');

    // Switch to BOOKS tab
    const bookTab = root.findByProps({ testID: 'watchlist-tab-book' });
    act(() => {
      bookTab.props.onPress();
    });
    expect(flatList.props.data.length).toBe(1);
    expect(flatList.props.data[0].title).toBe('Neuromancer');
  });

  it('filters items by platform chip', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const flatList = root.findByProps({ testID: 'watchlist-items-list' });

    // Filter by Netflix
    const netflixChip = root.findByProps({ testID: 'platform-chip-netflix' });
    act(() => {
      netflixChip.props.onPress();
    });

    expect(flatList.props.data.length).toBe(1);
    expect(flatList.props.data[0].title).toBe('Jiro Dreams of Sushi');

    // Tapping 'ALL' chip clears platform filter
    const allChip = root.findByProps({ testID: 'platform-chip-all' });
    act(() => {
      allChip.props.onPress();
    });
    expect(flatList.props.data.length).toBe(4);
  });

  it('handles quick capture input and calls onCreateCulturalItem', async () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const textInput = root.findByProps({ testID: 'watchlist-input' });
    const addButton = root.findByProps({ testID: 'watchlist-add-btn' });

    act(() => {
      textInput.props.onChangeText('Chinatown (1974) [Criterion] 130 min');
    });

    await act(async () => {
      await addButton.props.onPress();
    });

    expect(defaultProps.onCreateCulturalItem).toHaveBeenCalledTimes(1);
    const calledArg = defaultProps.onCreateCulturalItem.mock.calls[0][0];
    expect(calledArg.title).toContain('Chinatown');
    expect(calledArg.culturalMetadata.platform).toBe('Criterion');
    expect(calledArg.culturalMetadata.releaseYear).toBe(1974);
  });

  it('toggles complete status on cultural item', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const toggleButton = root.findByProps({ testID: 'watchlist-complete-btn-item-1' });

    act(() => {
      toggleButton.props.onPress();
    });

    expect(defaultProps.onToggleComplete).toHaveBeenCalledWith('item-1');
  });

  it('calls onDeleteReminder when delete button pressed', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const deleteButton = root.findByProps({ testID: 'watchlist-delete-btn-item-1' });

    act(() => {
      deleteButton.props.onPress();
    });

    expect(defaultProps.onDeleteReminder).toHaveBeenCalledWith('item-1');
  });

  it('calls onSnoozeReminder when for weekend button pressed', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const weekendBtn = root.findByProps({ testID: 'watchlist-weekend-btn-item-1' });

    act(() => {
      weekendBtn.props.onPress();
    });

    expect(defaultProps.onSnoozeReminder).toHaveBeenCalledWith('item-1', expect.any(Date));
  });

  it('calls onClose when close button tapped', () => {
    const renderer = renderScreen();
    const root = renderer.root;
    const closeBtn = root.findByProps({ testID: 'watchlist-close-btn' });

    act(() => {
      closeBtn.props.onPress();
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
