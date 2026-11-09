/**
 * YouTube Transcript Copier — Popup Translator Controller (v2.8.4)
 * 
 * Manages the UI interactions for in-popup local translation:
 * - Populates the prominent language picker with 30 supported languages.
 * - Bridges TranslatorEngine with popup workspace without modifying legacy extraction logic.
 * - Preserves original segments for instantaneous one-click reverting.
 * - Updates the main Copy button text to reflect the translated state.
 */

(function () {
  'use strict';

  let currentTargetLang = null;
  let activeAbortController = null;

  function initTranslatorUI() {
    const bar = document.getElementById('workspace-translate-bar');
    const select = document.getElementById('workspace-translate-select');
    const revertBtn = document.getElementById('btn-revert-translation');
    const statusDesc = document.getElementById('trans-status-desc');
    const progressBanner = document.getElementById('translation-progress-banner');
    const progressText = document.getElementById('translation-progress-text');
    const progressBar = document.getElementById('translation-progress-bar');
    const engineBadge = document.getElementById('translation-engine-badge');
    const copyBtnText = document.getElementById('copy-btn-text');

    if (!select || !window.TranslatorEngine) return;

    // Populate target languages
    if (select.options.length <= 1) {
      select.innerHTML = '<option value="" disabled selected>Choose Language...</option>';
      window.TranslatorEngine.SUPPORTED_LANGUAGES.forEach((lang) => {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = `${lang.native} (${lang.name})`;
        select.appendChild(opt);
      });
    }

    // Handle language selection
    select.addEventListener('change', async (e) => {
      const targetLang = e.target.value;
      if (!targetLang) return;

      const data = typeof window.__getTranscriptData === 'function' ? window.__getTranscriptData() : null;
      if (!data || !Array.isArray(data.lines) || data.lines.length === 0) {
        select.selectedIndex = 0;
        return;
      }

      // Preserve original lines before translating
      if (!data.originalLines) {
        data.originalLines = data.lines.map((l) => ({ ...l }));
        data.originalCaptionLang = data.captionLanguage || 'Original';
      }

      // If user selected original, revert
      if (targetLang === 'original') {
        revertToOriginal();
        return;
      }

      // Abort previous in-flight translation
      if (activeAbortController) {
        activeAbortController.abort();
      }
      activeAbortController = new AbortController();

      const langObj = window.TranslatorEngine.SUPPORTED_LANGUAGES.find((l) => l.code === targetLang);
      const langName = langObj ? langObj.name : targetLang;

      // Show progress banner
      if (progressBanner) {
        progressBanner.classList.remove('hidden');
        if (progressText) progressText.textContent = `Translating to ${langName}... 0%`;
        if (progressBar) progressBar.style.width = '0%';
        if (engineBadge) engineBadge.textContent = 'Translating...';
      }
      select.disabled = true;

      try {
        const result = await window.TranslatorEngine.translateSegments(data.originalLines, targetLang, {
          videoId: data.videoId || 'current',
          signal: activeAbortController.signal,
          onProgress: (percent) => {
            if (progressText) progressText.textContent = `Translating to ${langName}... ${percent}%`;
            if (progressBar) progressBar.style.width = `${percent}%`;
          }
        });

        if (result.success && Array.isArray(result.segments)) {
          currentTargetLang = targetLang;
          data.lines = result.segments;
          data.translatedLanguage = langName;
          data.translatedLangCode = targetLang;
          data.translationEngine = result.engine;

          if (typeof window.__setTranscriptData === 'function') {
            window.__setTranscriptData(data);
          }

          // Update UI States
          if (bar) bar.classList.add('active');
          if (revertBtn) revertBtn.classList.remove('hidden');
          if (statusDesc) statusDesc.textContent = `Translated to ${langName} (${result.engine})`;
          if (copyBtnText) copyBtnText.textContent = `Copy Translated (${langName})`;

          if (typeof window.showToast === 'function') {
            window.showToast(`Translated to ${langName} successfully!`, false);
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError' && !err.message.includes('aborted')) {
          console.error('[PopupTranslator] Translation failed:', err);
          if (typeof window.showToast === 'function') {
            window.showToast(`Translation error: ${err.message}`, true);
          }
        }
      } finally {
        select.disabled = false;
        activeAbortController = null;
        if (progressBanner) {
          progressBanner.classList.add('hidden');
        }
      }
    });

    // Revert button click handler
    if (revertBtn) {
      revertBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        revertToOriginal();
      });
    }

    function revertToOriginal() {
      const data = typeof window.__getTranscriptData === 'function' ? window.__getTranscriptData() : null;
      if (data && data.originalLines) {
        data.lines = data.originalLines.map((l) => ({ ...l }));
        delete data.translatedLanguage;
        delete data.translatedLangCode;
        delete data.translationEngine;

        if (typeof window.__setTranscriptData === 'function') {
          window.__setTranscriptData(data);
        }
      }

      currentTargetLang = null;
      select.selectedIndex = 0;
      if (bar) bar.classList.remove('active');
      if (revertBtn) revertBtn.classList.add('hidden');
      if (statusDesc) statusDesc.textContent = 'Instant local translation (30 languages)';
      if (copyBtnText) copyBtnText.textContent = 'Copy Transcript';
      if (progressBanner) progressBanner.classList.add('hidden');

      if (typeof window.showToast === 'function') {
        window.showToast('Restored original transcript', false);
      }
    }

    // Expose reset API for when a new video is loaded
    window.PopupTranslator = {
      reset() {
        revertToOriginal();
      },
      getCurrentTargetLang() {
        return currentTargetLang;
      }
    };
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTranslatorUI);
  } else {
    initTranslatorUI();
  }

  // Listen for transcript updates from popup
  window.addEventListener('transcript-data-updated', (e) => {
    const data = e.detail;
    const bar = document.getElementById('workspace-translate-bar');
    if (bar) {
      if (data && Array.isArray(data.lines) && data.lines.length > 0) {
        bar.style.display = 'flex';
      } else {
        bar.style.display = 'none';
      }
    }
  });

  // Listen for new video load to reset translator state
  window.addEventListener('transcript-new-video', () => {
    if (window.PopupTranslator) {
      window.PopupTranslator.reset();
    }
  });
})();
