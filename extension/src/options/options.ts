import '../theme/swissVoid.css';
import { storageService } from '../services/storageService';

/**
 * Remy Web Browser Extension - Options Page
 * Manages apiUrl, token, and custom lingo stored in chrome.storage.sync
 */
document.addEventListener('DOMContentLoaded', async () => {
  await storageService.init();
  const config = storageService.getConfig();

  const apiUrlInput = document.getElementById('api-url') as HTMLInputElement | null;
  const authTokenInput = document.getElementById('auth-token') as HTMLInputElement | null;
  const customLingoInput = document.getElementById('custom-lingo') as HTMLTextAreaElement | null;
  const saveBtn = document.getElementById('save-btn');

  if (apiUrlInput) apiUrlInput.value = config.apiUrl;
  if (authTokenInput) authTokenInput.value = config.token;
  if (customLingoInput) customLingoInput.value = config.customLingo || '';

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.textContent = 'Saving...';
      const updated = {
        apiUrl: apiUrlInput?.value.trim() || config.apiUrl,
        token: authTokenInput?.value.trim() || config.token,
        customLingo: customLingoInput?.value || '',
      };
      await storageService.saveConfig(updated);
      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        saveBtn.textContent = 'Save Changes';
      }, 1500);
    });
  }
});
