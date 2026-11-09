/**
 * YouTube Transcript Copier — Local Translator Engine (v2.8.4)
 * 
 * Provides hybrid, zero-configuration local translation for transcript segments:
 * - Tier 1: Chrome Built-in On-Device AI (self.translation / Gemini Nano) when available.
 * - Tier 2: High-speed Chrome Extension client endpoint (dict-chrome-ex) with chunked batching.
 * - Tier 3: Secondary public fallback for resilience.
 * 
 * Preserves timestamps, provides progress callbacks, and caches translations in memory.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TranslatorEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Comprehensive list of supported target languages
  const SUPPORTED_LANGUAGES = [
    { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
    { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
    { code: 'cs', name: 'Czech', native: 'Čeština' },
    { code: 'da', name: 'Danish', native: 'Dansk' },
    { code: 'nl', name: 'Dutch', native: 'Nederlands' },
    { code: 'en', name: 'English', native: 'English' },
    { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
    { code: 'fi', name: 'Finnish', native: 'Suomi' },
    { code: 'fr', name: 'French', native: 'Français' },
    { code: 'de', name: 'German', native: 'Deutsch' },
    { code: 'el', name: 'Greek', native: 'Ελληνικά' },
    { code: 'he', name: 'Hebrew', native: 'עברית', rtl: true },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'hu', name: 'Hungarian', native: 'Magyar' },
    { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'it', name: 'Italian', native: 'Italiano' },
    { code: 'ja', name: 'Japanese', native: '日本語' },
    { code: 'ko', name: 'Korean', native: '한국어' },
    { code: 'no', name: 'Norwegian', native: 'Norsk' },
    { code: 'pl', name: 'Polish', native: 'Polski' },
    { code: 'pt', name: 'Portuguese', native: 'Português' },
    { code: 'ro', name: 'Romanian', native: 'Română' },
    { code: 'ru', name: 'Russian', native: 'Русский' },
    { code: 'es', name: 'Spanish', native: 'Español' },
    { code: 'sv', name: 'Swedish', native: 'Svenska' },
    { code: 'th', name: 'Thai', native: 'ไทย' },
    { code: 'tr', name: 'Turkish', native: 'Türkçe' },
    { code: 'uk', name: 'Ukrainian', native: 'Українська' },
    { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' }
  ];

  // In-memory cache keyed by `${videoId || 'current'}_${targetLang}`
  const translationCache = new Map();

  /**
   * Check if Chrome's Built-in On-Device Translation API is available
   */
  async function checkBuiltinAIAvailability(targetLang, sourceLang = 'en') {
    try {
      if (typeof window !== 'undefined' && 'translation' in window && typeof window.translation.canTranslate === 'function') {
        const status = await window.translation.canTranslate({
          sourceLanguage: sourceLang,
          targetLanguage: targetLang
        });
        return status === 'readily' || status === 'after-download';
      }
      if (typeof window !== 'undefined' && window.ai && window.ai.translator && typeof window.ai.translator.capabilities === 'function') {
        const caps = await window.ai.translator.capabilities();
        const available = caps?.available;
        return available === 'readily' || available === 'after-download';
      }
    } catch {
      // Chrome Built-in AI not available or flag not enabled
    }
    return false;
  }

  /**
   * Translate a block of text using Chrome's Built-in On-Device AI
   */
  async function translateWithBuiltinAI(text, targetLang, sourceLang = 'en') {
    if (typeof window !== 'undefined' && window.translation && typeof window.translation.createTranslator === 'function') {
      const translator = await window.translation.createTranslator({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang
      });
      return await translator.translate(text);
    }
    if (typeof window !== 'undefined' && window.ai?.translator?.create) {
      const translator = await window.ai.translator.create({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang
      });
      return await translator.translate(text);
    }
    throw new Error('Chrome Built-in AI not accessible');
  }

  /**
   * Translate text batch using the designated Chrome Extension endpoint
   */
  async function translateWithClientEndpoint(text, targetLang, sourceLang = 'auto', signal = null) {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encoded}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal
    });

    if (!res.ok) {
      throw new Error(`Translation endpoint HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Malformed response from translation endpoint');
    }

    // data[0] contains pairs of [translatedChunk, originalChunk]
    return data[0].map((chunk) => chunk[0] || '').join('');
  }

  /**
   * Secondary public fallback endpoint (MyMemory)
   */
  async function translateWithFallbackEndpoint(text, targetLang, sourceLang = 'en', signal = null) {
    const langpair = `${sourceLang}|${targetLang}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
    
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
    const data = await res.json();
    if (data?.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
    throw new Error('Invalid fallback response');
  }

  /**
   * Split an array of transcript segments into balanced batches
   * We keep batch size around 30-40 segments or ~1,500 characters
   */
  function chunkSegments(segments, maxItems = 35, maxChars = 1400) {
    const batches = [];
    let currentBatch = [];
    let currentChars = 0;

    for (const seg of segments) {
      const segLen = (seg.text || '').length + 1; // +1 for newline
      if (currentBatch.length >= maxItems || (currentChars + segLen > maxChars && currentBatch.length > 0)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }
      currentBatch.push(seg);
      currentChars += segLen;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    return batches;
  }

  /**
   * Main Translation Function: Translates transcript segments while preserving
   * original timestamps, metadata, and data structure.
   *
   * @param {Array<{timestamp: string, text: string}>} segments - Original transcript segments
   * @param {string} targetLang - Target language code (e.g. 'es', 'ar', 'de')
   * @param {Object} options - Optional parameters:
   *   - sourceLang: default 'auto'
   *   - videoId: string for caching
   *   - onProgress: callback (percent: number, currentBatch: number, totalBatches: number)
   *   - signal: AbortSignal to cancel in-flight translation
   */
  async function translateSegments(segments, targetLang, options = {}) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return { success: true, segments: [], engine: 'none' };
    }

    const {
      sourceLang = 'auto',
      videoId = 'current',
      onProgress = null,
      signal = null
    } = options;

    const cacheKey = `${videoId}_${targetLang}`;
    if (translationCache.has(cacheKey)) {
      if (typeof onProgress === 'function') onProgress(100, 1, 1);
      return {
        success: true,
        segments: translationCache.get(cacheKey),
        engine: 'cache',
        cached: true
      };
    }

    // Step 1: Detect if Chrome Built-in AI is ready
    let useBuiltinAI = false;
    try {
      useBuiltinAI = await checkBuiltinAIAvailability(targetLang, sourceLang === 'auto' ? 'en' : sourceLang);
    } catch {
      useBuiltinAI = false;
    }

    const batches = chunkSegments(segments);
    const totalBatches = batches.length;
    const translatedSegments = [];
    let usedEngine = useBuiltinAI ? 'chrome-builtin-ai' : 'client-endpoint';

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      if (signal && signal.aborted) {
        throw new Error('Translation aborted by user');
      }

      const batch = batches[bIdx];
      // Join batch lines using newline separator
      const combinedText = batch.map((s) => (s.text || '').trim()).join('\n');

      let translatedBatchText = '';

      if (useBuiltinAI) {
        try {
          translatedBatchText = await translateWithBuiltinAI(combinedText, targetLang, sourceLang === 'auto' ? 'en' : sourceLang);
        } catch (builtinErr) {
          console.warn('[TranslatorEngine] Builtin AI failed, falling back to client endpoint:', builtinErr);
          useBuiltinAI = false;
          usedEngine = 'client-endpoint';
        }
      }

      if (!useBuiltinAI) {
        try {
          translatedBatchText = await translateWithClientEndpoint(combinedText, targetLang, sourceLang, signal);
        } catch (clientErr) {
          console.warn('[TranslatorEngine] Primary client endpoint failed, trying fallback:', clientErr);
          try {
            translatedBatchText = await translateWithFallbackEndpoint(combinedText, targetLang, sourceLang === 'auto' ? 'en' : sourceLang, signal);
            usedEngine = 'mymemory-fallback';
          } catch (fallbackErr) {
            throw new Error(`All translation engines failed: ${clientErr.message}`);
          }
        }
      }

      // Split translated text back into segment lines
      let translatedLines = (translatedBatchText || '').split('\n').map((l) => l.trim());

      // Resilience guard: If the translation engine collapsed or expanded lines, align them safely
      if (translatedLines.length !== batch.length) {
        if (translatedLines.length === 1 && batch.length > 1) {
          // Engine combined lines into one string: evenly distribute or keep intact
          translatedLines = [translatedLines[0]];
          for (let i = 1; i < batch.length; i++) {
            translatedLines.push(batch[i].text);
          }
        } else if (translatedLines.length < batch.length) {
          // Fill remaining with original text
          while (translatedLines.length < batch.length) {
            translatedLines.push(batch[translatedLines.length].text);
          }
        } else {
          // More lines than expected: slice to match
          translatedLines = translatedLines.slice(0, batch.length);
        }
      }

      // Map back to segments preserving timestamps and metadata
      for (let i = 0; i < batch.length; i++) {
        translatedSegments.push({
          ...batch[i],
          text: translatedLines[i] || batch[i].text,
          originalText: batch[i].text
        });
      }

      // Report progress
      if (typeof onProgress === 'function') {
        const percent = Math.min(99, Math.round(((bIdx + 1) / totalBatches) * 100));
        onProgress(percent, bIdx + 1, totalBatches);
      }

      // Gentle pause between batches to prevent any network throttling
      if (bIdx < batches.length - 1 && !useBuiltinAI) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    if (typeof onProgress === 'function') {
      onProgress(100, totalBatches, totalBatches);
    }

    // Cache the result
    translationCache.set(cacheKey, translatedSegments);

    return {
      success: true,
      segments: translatedSegments,
      engine: usedEngine,
      cached: false
    };
  }

  /**
   * Clear the in-memory translation cache (e.g. when switching videos)
   */
  function clearCache(videoId = null) {
    if (videoId) {
      for (const key of translationCache.keys()) {
        if (key.startsWith(`${videoId}_`)) {
          translationCache.delete(key);
        }
      }
    } else {
      translationCache.clear();
    }
  }

  return {
    SUPPORTED_LANGUAGES,
    translateSegments,
    checkBuiltinAIAvailability,
    translateWithClientEndpoint,
    clearCache
  };
});
