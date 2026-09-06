/**
 * YouTube Transcript Copier — AI Web Auto-Paste Script (v2.7.0)
 * ============================================================
 * Structured Provider Adapters for seamless client-side transcript forwarding
 * to ChatGPT, Claude, and Gemini with zero external API keys.
 */

class BaseProviderAdapter {
  constructor(name) {
    this.name = name;
  }
  canHandle(url) {
    return false;
  }
  detectReady(doc) {
    return { ready: false, inputEl: null, reason: 'Base adapter' };
  }
  async injectPrompt(doc, text) {
    return false;
  }
  detectFailure(doc) {
    return { failed: false, reason: '' };
  }
}

class ChatGPTAdapter extends BaseProviderAdapter {
  constructor() {
    super('ChatGPT');
  }
  canHandle(url) {
    return typeof url === 'string' && url.includes('chatgpt.com');
  }
  detectReady(doc) {
    if (!doc) return { ready: false, inputEl: null, reason: 'No document' };
    const inputEl =
      doc.querySelector('#prompt-textarea') ||
      doc.querySelector('div[id="prompt-textarea"]') ||
      doc.querySelector('div[contenteditable="true"]');

    if (inputEl && (inputEl.offsetWidth > 0 || doc.defaultView === null)) {
      // If defaultView is null, it might be a mock DOM in test runner
      const stopBtn = doc.querySelector('button[data-testid="stop-button"]');
      if (stopBtn) {
        return { ready: false, inputEl, reason: 'Streaming active' };
      }
      return { ready: true, inputEl, reason: 'Hydrated prompt-textarea found' };
    }
    return { ready: false, inputEl: null, reason: 'Waiting for textarea hydration' };
  }
  async injectPrompt(doc, text) {
    const { ready, inputEl } = this.detectReady(doc);
    if (!ready || !inputEl) return false;
    inputEl.focus?.();
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } else {
      try {
        const win = doc.defaultView || window;
        const sel = win.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(inputEl);
        sel.removeAllRanges();
        sel.addRange(range);
        doc.execCommand('insertText', false, text);
      } catch (e) {
        inputEl.textContent = text;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  detectFailure(doc) {
    if (!doc) return { failed: false };
    const errorBanner = doc.querySelector('[data-testid="error-banner"]') || doc.querySelector('.text-token-text-error');
    if (errorBanner) {
      return { failed: true, reason: errorBanner.textContent || 'ChatGPT error banner' };
    }
    return { failed: false };
  }
}

class ClaudeAdapter extends BaseProviderAdapter {
  constructor() {
    super('Claude');
  }
  canHandle(url) {
    return typeof url === 'string' && url.includes('claude.ai');
  }
  detectReady(doc) {
    if (!doc) return { ready: false, inputEl: null, reason: 'No document' };
    const inputEl =
      doc.querySelector('div[contenteditable="true"].ProseMirror') ||
      doc.querySelector('div[contenteditable="true"]') ||
      doc.querySelector('fieldset div[contenteditable="true"]');

    if (inputEl && (inputEl.offsetWidth > 0 || doc.defaultView === null)) {
      return { ready: true, inputEl, reason: 'ProseMirror editable container found' };
    }
    return { ready: false, inputEl: null, reason: 'Waiting for Claude composer' };
  }
  async injectPrompt(doc, text) {
    const { ready, inputEl } = this.detectReady(doc);
    if (!ready || !inputEl) return false;
    inputEl.focus?.();
    try {
      const win = doc.defaultView || window;
      const sel = win.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(inputEl);
      sel.removeAllRanges();
      sel.addRange(range);
      doc.execCommand('insertText', false, text);
    } catch (e) {
      inputEl.textContent = text;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  detectFailure(doc) {
    if (!doc) return { failed: false };
    const rateLimit = doc.querySelector('[data-testid="rate-limit-banner"]');
    if (rateLimit) {
      return { failed: true, reason: 'Claude rate limit' };
    }
    return { failed: false };
  }
}

class GeminiAdapter extends BaseProviderAdapter {
  constructor() {
    super('Gemini');
  }
  canHandle(url) {
    return typeof url === 'string' && url.includes('gemini.google.com');
  }
  detectReady(doc) {
    if (!doc) return { ready: false, inputEl: null, reason: 'No document' };
    const inputEl =
      doc.querySelector('rich-textarea div[contenteditable="true"]') ||
      doc.querySelector('div.ql-editor') ||
      doc.querySelector('div[contenteditable="true"]') ||
      doc.querySelector('textarea[aria-label*="prompt" i]');

    if (inputEl && (inputEl.offsetWidth > 0 || doc.defaultView === null)) {
      return { ready: true, inputEl, reason: 'Rich textarea or QL editor found' };
    }
    return { ready: false, inputEl: null, reason: 'Waiting for Gemini prompt editor' };
  }
  async injectPrompt(doc, text) {
    const { ready, inputEl } = this.detectReady(doc);
    if (!ready || !inputEl) return false;
    inputEl.focus?.();
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } else {
      try {
        const win = doc.defaultView || window;
        const sel = win.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(inputEl);
        sel.removeAllRanges();
        sel.addRange(range);
        doc.execCommand('insertText', false, text);
      } catch (e) {
        inputEl.textContent = text;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  detectFailure(doc) {
    return { failed: false };
  }
}

const PROVIDER_ADAPTERS = [new ChatGPTAdapter(), new ClaudeAdapter(), new GeminiAdapter()];

function resolveAdapter(url) {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.canHandle(url)) || null;
}

// Self-executing runtime when injected into browser page
if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  (async function initAutoPaste() {
    try {
      const data = await chrome.storage.local.get('pending_ai_prompt');
      const pending = data?.pending_ai_prompt;

      if (!pending || !pending.text || !pending.timestamp) return;

      // Expire requests older than 90 seconds
      if (Date.now() - pending.timestamp > 90000) {
        await chrome.storage.local.remove('pending_ai_prompt');
        return;
      }

      const currentUrl = window.location.href;
      const adapter = resolveAdapter(currentUrl);
      if (!adapter) {
        console.warn('[YT Transcript Copier] No AI provider adapter matches:', currentUrl);
        return;
      }

      const textToInsert = pending.text;
      await chrome.storage.local.remove('pending_ai_prompt');

      let attempts = 0;
      const maxAttempts = 30; // 15 seconds max

      const pollInterval = setInterval(async () => {
        attempts++;

        const failure = adapter.detectFailure(document);
        if (failure.failed) {
          console.warn(`[YT Transcript Copier] Provider ${adapter.name} reported failure:`, failure.reason);
          clearInterval(pollInterval);
          return;
        }

        const readiness = adapter.detectReady(document);
        if (readiness.ready) {
          const success = await adapter.injectPrompt(document, textToInsert);
          if (success) {
            clearInterval(pollInterval);
            console.log(`[YT Transcript Copier] Injected prompt using ${adapter.name} adapter.`);
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn(`[YT Transcript Copier] Timed out waiting for ${adapter.name} input readiness.`);
        }
      }, 500);
    } catch (err) {
      console.warn('[YT Transcript Copier] Auto-paste exception:', err);
    }
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BaseProviderAdapter,
    ChatGPTAdapter,
    ClaudeAdapter,
    GeminiAdapter,
    PROVIDER_ADAPTERS,
    resolveAdapter,
  };
}
