import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import {
  compileCapture,
  compileCaptureWithIntent,
  compileMultiLineCapture,
  parseMusicIntent,
} from '../src/utils/captureCompilerCore';
import { audioService } from '../src/services/audioService';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { HomeScreen } from '../src/screens/HomeScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';

describe('Zero Context-Switch Natural Language Music Playback Grammar', () => {
  const fixedNow = new Date('2026-09-20T12:00:00.000Z');

  describe('Audio Verbs and Music Markers Grammar', () => {
    it('detects "play spb songs hindi" as immediate music playback', () => {
      const draft = compileCaptureWithIntent('play spb songs hindi', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.action).toBe('play');
      expect(draft.musicDraft?.cleanQuery).toBe('spb songs hindi');
      expect(draft.musicDraft?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(draft.musicDraft?.hasTimeCue).toBe(false);
      expect(draft.armed).toBe(false);
      expect(draft.preset).toBe('inbox');
    });

    it('detects "play lofi" with high confidence', () => {
      const draft = compileCapture('play lofi', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('lofi');
      expect(draft.musicDraft?.hasTimeCue).toBe(false);
    });

    it('detects "listen to" audio verb', () => {
      const draft = compileCaptureWithIntent('listen to Kishore Kumar songs', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('Kishore Kumar songs');
      expect(draft.musicDraft?.action).toBe('play');
    });

    it('detects "put on" audio verb', () => {
      const draft = compileCaptureWithIntent('put on Arijit Singh', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('Arijit Singh');
    });

    it('detects "stream" audio verb', () => {
      const draft = compileCaptureWithIntent('stream jazz playlist', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('jazz playlist');
    });

    it('detects "hear" audio verb', () => {
      const draft = compileCaptureWithIntent('hear ghazals', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('ghazals');
    });

    it('detects standalone music query without leading verb', () => {
      const draft = compileCaptureWithIntent('spb songs hindi', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('spb songs hindi');
    });
  });

  describe('Disambiguation Against Sports and Physical Tasks', () => {
    it('disambiguates "play tennis" as non-music physical task', () => {
      const draft = compileCaptureWithIntent('play tennis', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeUndefined();
      expect(draft.title).toBe('play tennis');
      expect(draft.armed).toBe(false);
    });

    it('disambiguates "play chess" as non-music task', () => {
      const draft = compileCapture('play chess', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeUndefined();
    });

    it('disambiguates "play with kids" as family task', () => {
      const draft = compileCaptureWithIntent('play with kids', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeUndefined();
    });

    it('disambiguates "play badminton" as sports task', () => {
      const draft = compileCapture('play badminton', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeUndefined();
    });

    it('disambiguates "play football" as physical game', () => {
      const draft = compileCapture('play football', 'inbox', fixedNow);
      expect(draft.musicDraft).toBeUndefined();
    });

    it('disambiguates "play guitar" instrument practice unless accompanied by music markers', () => {
      const instrument = compileCapture('play guitar', 'inbox', fixedNow);
      expect(instrument.musicDraft).toBeUndefined();

      const musicStream = compileCapture('play guitar songs', 'inbox', fixedNow);
      expect(musicStream.musicDraft).toBeDefined();
      expect(musicStream.musicDraft?.cleanQuery).toBe('guitar songs');
    });

    it('disqualifies standard action verbs like buy, call, pay', () => {
      expect(parseMusicIntent('buy spb songs')).toBeNull();
      expect(parseMusicIntent('call about music festival')).toBeNull();
      expect(parseMusicIntent('pay music subscription')).toBeNull();
    });

    it('disambiguates "listen to <family/duty/advice>" as non-music reminder', () => {
      expect(compileCaptureWithIntent('listen to mom', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('listen to dad', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('listen to voicemail', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('listen to my wife', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('listen to lecture', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('listen to reason', 'inbox', fixedNow).musicDraft).toBeUndefined();

      // Prospective time cue with non-music target remains normal reminder
      const timedDoctor = compileCaptureWithIntent('listen to doctor tonight', 'inbox', fixedNow);
      expect(timedDoctor.musicDraft).toBeUndefined();
      expect(timedDoctor.armed).toBe(true);
      expect(timedDoctor.preset).toBe('evening');
    });

    it('disambiguates "play with <people/pets>" and casual games as non-music task', () => {
      expect(compileCaptureWithIntent('play with mom', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play with my son', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play with dog', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play a game', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play the game', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play games', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('play pickleball', 'inbox', fixedNow).musicDraft).toBeUndefined();
    });

    it('disambiguates "put on <clothing/appliance/chore>" as non-music task', () => {
      expect(compileCaptureWithIntent('put on jacket', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('put on kettle', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('put on laundry', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('put on shoes', 'inbox', fixedNow).musicDraft).toBeUndefined();
    });

    it('disambiguates "hear <from/back/out>" and "stream <movie/show>" as non-music task', () => {
      expect(compileCaptureWithIntent('hear back from recruiter', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('hear from mom', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('hear out John', 'inbox', fixedNow).musicDraft).toBeUndefined();
      expect(compileCaptureWithIntent('stream movie tonight', 'inbox', fixedNow).musicDraft).toBeUndefined();
    });
  });

  describe('Disambiguation Against Prospective Time Cues', () => {
    it('marks "listen to SPB tonight" as timed prospective reminder with audio metadata', () => {
      const draft = compileCaptureWithIntent('listen to SPB tonight', 'inbox', fixedNow);
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('evening');
      expect(draft.musicDraft).toBeDefined();
      expect(draft.musicDraft?.cleanQuery).toBe('SPB');
      expect(draft.musicDraft?.hasTimeCue).toBe(true);
    });

    it('marks "play lofi tomorrow morning" as timed reminder', () => {
      const draft = compileCapture('play lofi tomorrow morning', 'inbox', fixedNow);
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('tomorrow_morning');
      expect(draft.musicDraft?.cleanQuery).toBe('lofi');
      expect(draft.musicDraft?.hasTimeCue).toBe(true);
    });

    it('attaches timed music draft when preset chip is selected', () => {
      const draft = compileCapture('play lofi', '1h', fixedNow);
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('1h');
      expect(draft.musicDraft?.hasTimeCue).toBe(true);
    });
  });

  describe('Multi-line Thought Dump with Audio Queries', () => {
    it('compiles mixed list of music and normal tasks correctly', () => {
      const text = 'play spb songs hindi\nplay tennis tomorrow morning\ndahi';
      const drafts = compileMultiLineCapture(text, 'inbox', fixedNow);
      expect(drafts).toHaveLength(3);

      // 1. Immediate music
      expect(drafts[0].musicDraft?.cleanQuery).toBe('spb songs hindi');
      expect(drafts[0].armed).toBe(false);

      // 2. Physical task timed
      expect(drafts[1].musicDraft).toBeUndefined();
      expect(drafts[1].armed).toBe(true);
      expect(drafts[1].preset).toBe('tomorrow_morning');

      // 3. Regular task
      expect(drafts[2].musicDraft).toBeUndefined();
      expect(drafts[2].title).toBe('dahi lena');
    });
  });
});

describe('AudioService Engine', () => {
  afterEach(() => {
    audioService.stop();
  });

  it('resolves SPB Hindi stream query to S.P. Balasubrahmanyam metadata', () => {
    const track = audioService.resolveTrack('play spb songs hindi');
    expect(track.artist).toContain('Balasubrahmanyam');
    expect(track.source).toBe('jiosaavn_cdn');
    expect(track.streamUrl).toBeDefined();
  });

  it('resolves Lofi queries to ambient stream', () => {
    const track = audioService.resolveTrack('play lofi');
    expect(track.title).toContain('Lofi');
    expect(track.streamUrl).toContain('zeno.fm');
  });

  it('manages play, pause, resume, toggle, stop lifecycle and notifies subscribers', async () => {
    const listener = jest.fn();
    const unsub = audioService.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ isPlaying: false, currentTrack: null })
    );

    // Play
    await act(async () => {
      await audioService.play('play lofi');
    });

    expect(audioService.getState().isPlaying).toBe(true);
    expect(audioService.getState().currentTrack?.title).toContain('Lofi');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ isPlaying: true })
    );

    // Pause
    act(() => {
      audioService.pause();
    });
    expect(audioService.getState().isPlaying).toBe(false);

    // Toggle (resumes)
    act(() => {
      audioService.toggle();
    });
    expect(audioService.getState().isPlaying).toBe(true);

    // Stop
    act(() => {
      audioService.stop();
    });
    expect(audioService.getState().isPlaying).toBe(false);
    expect(audioService.getState().currentTrack).toBeNull();

    unsub();
  });

  it('strips audio verb from fallback track title', () => {
    const track = audioService.resolveTrack('play coldplay');
    expect(track.title).toBe('Coldplay');
    expect(track.artist).toBe('Remy Radio Stream');
  });

  it('handles empty or whitespace query safely', () => {
    const track = audioService.resolveTrack('   ');
    expect(track.title).toBe('Remy Radio Stream');
    expect(track.duration).toBe(0);
  });
});

describe('QuickCaptureBar Music Intent Ingress & Preview', () => {
  beforeEach(() => {
    audioService.stop();
  });

  it('displays "▶ PLAY: <query> · STREAM" live preview for immediate music query', async () => {
    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <QuickCaptureBar onCreateReminder={jest.fn()} />
        </ThemeProvider>
      );
    });

    const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
    act(() => {
      input.props.onChangeText('play spb songs hindi');
    });

    const preview = renderer.root.findByProps({ testID: 'capture-preview' });
    expect(preview.props.children).toBe('▶ PLAY: spb songs hindi · STREAM');

    act(() => {
      renderer.unmount();
    });
  });

  it('does NOT display music stream preview for physical sports like "play tennis"', async () => {
    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <QuickCaptureBar onCreateReminder={jest.fn()} />
        </ThemeProvider>
      );
    });

    const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
    act(() => {
      input.props.onChangeText('play tennis');
    });

    const preview = renderer.root.findByProps({ testID: 'capture-preview' });
    expect(preview.props.children).not.toContain('▶ PLAY:');

    act(() => {
      renderer.unmount();
    });
  });

  it('submitting immediate music query dispatches to audioService without adding task', async () => {
    const onCreateReminder = jest.fn();
    const onPlayMusic = jest.fn();

    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <QuickCaptureBar
            onCreateReminder={onCreateReminder}
            onPlayMusic={onPlayMusic}
          />
        </ThemeProvider>
      );
    });

    const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
    act(() => {
      input.props.onChangeText('play lofi');
    });

    const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
    await act(async () => {
      await submitBtn.props.onPress();
    });

    expect(onPlayMusic).toHaveBeenCalledWith('lofi');
    expect(onCreateReminder).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('submitting timed music query creates a reminder with time cue', async () => {
    const onCreateReminder = jest.fn();
    const onPlayMusic = jest.fn();

    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <QuickCaptureBar
            onCreateReminder={onCreateReminder}
            onPlayMusic={onPlayMusic}
          />
        </ThemeProvider>
      );
    });

    const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
    act(() => {
      input.props.onChangeText('listen to SPB tonight');
    });

    const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
    await act(async () => {
      await submitBtn.props.onPress();
    });

    expect(onPlayMusic).not.toHaveBeenCalled();
    expect(onCreateReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        armed: true,
        preset: 'evening',
        musicDraft: expect.objectContaining({
          cleanQuery: 'SPB',
          hasTimeCue: true,
        }),
      })
    );

    act(() => {
      renderer.unmount();
    });
  });

  it('submitting "listen to mom" creates a normal reminder and does NOT play audio', async () => {
    const onCreateReminder = jest.fn();
    const onPlayMusic = jest.fn();

    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <QuickCaptureBar
            onCreateReminder={onCreateReminder}
            onPlayMusic={onPlayMusic}
          />
        </ThemeProvider>
      );
    });

    const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
    act(() => {
      input.props.onChangeText('listen to mom');
    });

    const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
    await act(async () => {
      await submitBtn.props.onPress();
    });

    expect(onPlayMusic).not.toHaveBeenCalled();
    expect(onCreateReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'listen to mom',
        armed: false,
      })
    );

    act(() => {
      renderer.unmount();
    });
  });
});

describe('HomeScreen Swiss Void Mini-Player Strip', () => {
  beforeEach(() => {
    audioService.stop();
  });

  afterEach(() => {
    audioService.stop();
  });

  it('does not render mini-player strip when idle', async () => {
    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <HomeScreen reminders={[]} />
        </ThemeProvider>
      );
    });

    const strips = renderer.root.findAllByProps({ testID: 'mini-player-strip' });
    expect(strips.length).toBe(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('renders docked mini-player strip when track is playing and toggles playback', async () => {
    let renderer: any = null;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialMode="dark">
          <HomeScreen reminders={[]} />
        </ThemeProvider>
      );
    });

    // Start playback
    await act(async () => {
      await audioService.play('play spb songs hindi');
    });

    const strip = renderer.root.findByProps({ testID: 'mini-player-strip' });
    expect(strip).toBeDefined();

    const titleText = renderer.root.findByProps({ testID: 'mini-player-title' });
    expect(titleText.props.children).toBe('Tere Mere Beech Mein');

    const artistText = renderer.root.findByProps({ testID: 'mini-player-artist' });
    expect(artistText.props.children).toContain('Balasubrahmanyam');

    // Toggle button
    const toggleBtn = renderer.root.findByProps({ testID: 'mini-player-toggle' });
    act(() => {
      toggleBtn.props.onPress();
    });
    expect(audioService.getState().isPlaying).toBe(false);

    // Stop button
    const stopBtn = renderer.root.findByProps({ testID: 'mini-player-stop' });
    act(() => {
      stopBtn.props.onPress();
    });
    expect(audioService.getState().currentTrack).toBeNull();

    const stripsAfterStop = renderer.root.findAllByProps({ testID: 'mini-player-strip' });
    expect(stripsAfterStop.length).toBe(0);

    act(() => {
      renderer.unmount();
    });
  });
});
