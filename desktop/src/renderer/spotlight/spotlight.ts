declare const remyAPI: any;

const input = document.getElementById('capture-input') as HTMLInputElement;
const previewBar = document.getElementById('preview-bar') as HTMLElement;
const badgePreset = document.getElementById('badge-preset') as HTMLElement;
const previewTime = document.getElementById('preview-time') as HTMLElement;
const badgeLingo = document.getElementById('badge-lingo') as HTMLElement;
const previewMusic = document.getElementById('preview-music') as HTMLElement;
const musicText = document.getElementById('music-text') as HTMLElement;

let debounceTimer: any = null;

function formatPreset(preset: string): string {
  switch (preset) {
    case '15m': return '+15m';
    case '1h': return '+1 Hour';
    case 'evening': return 'This Evening';
    case 'tomorrow_morning': return 'Tomorrow Morning';
    case 'weekend': return 'Weekend';
    case 'custom': return 'Scheduled';
    default: return 'Inbox';
  }
}

function formatDueTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

async function updatePreview(text: string) {
  if (!text || !text.trim()) {
    previewBar.classList.add('hidden');
    return;
  }

  try {
    const draft = await remyAPI.compilePreview(text);
    if (!draft) {
      previewBar.classList.add('hidden');
      return;
    }

    previewBar.classList.remove('hidden');
    badgePreset.textContent = formatPreset(draft.preset);
    previewTime.textContent = formatDueTime(draft.dueDate);

    if (draft.lingoKey) {
      badgeLingo.textContent = `⚡ ${draft.lingoKey}`;
      badgeLingo.classList.remove('hidden');
    } else {
      badgeLingo.classList.add('hidden');
    }

    if (draft.musicDraft) {
      musicText.textContent = draft.musicDraft.cleanQuery;
      previewMusic.classList.remove('hidden');
    } else {
      previewMusic.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error compiling preview:', err);
  }
}

input.addEventListener('input', () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updatePreview(input.value);
  }, 50);
});

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;

    try {
      await remyAPI.submitCapture(val);
      input.value = '';
      previewBar.classList.add('hidden');
    } catch (err) {
      console.error('Submit error:', err);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    input.value = '';
    previewBar.classList.add('hidden');
    await remyAPI.hideSpotlight();
  }
});

if (typeof remyAPI !== 'undefined' && remyAPI.onSpotlightFocus) {
  remyAPI.onSpotlightFocus(() => {
    input.focus();
    input.select();
  });
}
