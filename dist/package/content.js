/**
 * YouTube Transcript Copier — Content Script (v2.3.1 Reliability Architecture)
 *
 * Implements a Multi-Strategy Extraction Hierarchy:
 * Strategy 1: Tab Window Memory Inspection (window.ytInitialPlayerResponse)
 * Strategy 2: Embedded Script Tag JSON Parsing
 * Strategy 3: Native DOM Panel Scraper Fallback
 *
 * Architectural Principle:
 * Resistant to YouTube DOM/UI redesigns.
 * (Important: DOM independence != YouTube player/caption infrastructure independence)
 *
 * Canonical Error Taxonomy & Pipeline State Machine:
 *
 *              [YouTube Video Watch Page]
 *                         │
 *                         ▼
 *               ┌───────────────────┐
 *               │ 1. Availability   │ ──(Unavailable)──→ VIDEO_UNAVAILABLE
 *               └─────────┬─────────┘ ──(Age Gate)─────→ AGE_RESTRICTED
 *                         │
 *                         ▼
 *               ┌───────────────────┐
 *               │ 2. Caption Tracks │ ──(No tracks)────→ NO_CAPTIONS_AVAILABLE
 *               └─────────┬─────────┘
 *                         │
 *                         ▼
 *               ┌───────────────────┐ ──(Net Fail)─────→ NETWORK_ERROR / HTTP_ERROR
 *               │ 3. Extraction     │ ──(0 bytes)──────→ EMPTY_RESPONSE (suspected attestation)
 *               └─────────┬─────────┘ ──(Bad JSON/XML)─→ PARSE_ERROR
 *                         │
 *                         ▼
 *               ┌───────────────────┐
 *               │ 4. Normalization  │ ──(2-Pass Clean)─→ Validated Segments
 *               └─────────┬─────────┘
 *                         │
 *                         ▼
 *                      SUCCESS
 *
 * Class 1 (Video State): VIDEO_UNAVAILABLE, AGE_RESTRICTED, NO_CAPTIONS_AVAILABLE
 * Class 2 (Transport/Extraction): NETWORK_ERROR, HTTP_ERROR, EMPTY_RESPONSE, PARSE_ERROR, TRACK_NOT_FOUND, ATTESTATION_REQUIRED
 * Terminal: SUCCESS
 *
 * Tracks per-strategy diagnostic telemetry: SUCCESS, EMPTY_RESPONSE, NO_TRACKS, SKIPPED.
 */
(() => {
  // Prevent duplicate execution & lexical re-declaration in isolated world
  if (window.__ytcContentScriptLoaded) {
    return;
  }
  window.__ytcContentScriptLoaded = true;

  // ---- Normalizer Engine (Shared) ----
  function decodeHtmlEntities(str) {

  if (!str) return '';
  let res = str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Second pass for double-escaped entities (e.g. &amp;amp;, &amp;quot;, &amp;#39;)
  if (res.includes('&amp;') || res.includes('&lt;') || res.includes('&gt;') || res.includes('&quot;') || res.includes('&#39;') || res.includes('&apos;') || res.includes('&nbsp;')) {
    res = res
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
  return res;
}

function parseSecondsToTimestamp(startSec) {
  const totalSec = Math.floor(startSec || 0);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseCaptionTrackXmlOrJson(text) {
  const lines = [];

  // Try JSON3 parsing first
  try {
    const json = JSON.parse(text);
    if (json.events && Array.isArray(json.events)) {
      for (const event of json.events) {
        if (!event.segs) continue;
        const lineText = decodeHtmlEntities(
          event.segs.map((s) => s.utf8 || '').join('')
        );
        if (!lineText) continue;

        const startMs = event.tStartMs || 0;
        const totalSec = Math.floor(startMs / 1000);
        const timestamp = parseSecondsToTimestamp(totalSec);

        lines.push({ timestamp, startSeconds: totalSec, text: lineText });
      }
      if (lines.length > 0) return lines;
    }
  } catch {
    // Fall through to XML parsing
  }

  // XML Fallback (<text start="1.23" dur="4.56">Text</text>)
  const regex = /<text\s+start="([\d.]+)"[^>]*>(.*?)<\/text>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const startSec = parseFloat(match[1]) || 0;
    const rawText = decodeHtmlEntities(match[2]);
    if (!rawText) continue;

    const totalSec = Math.floor(startSec);
    const timestamp = parseSecondsToTimestamp(totalSec);

    lines.push({ timestamp, startSeconds: totalSec, text: rawText });
  }

  return lines;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generates a random human jitter delay: baseMs + random(0 to jitterMs).
 */
function humanDelay(baseMs, jitterMs = 0) {
  const extra = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return delay(baseMs + extra);
}

/**
 * Human-like click dispatcher:
 * - Smoothly scrolls to target
 * - Natural hesitation pause (120-240ms)
 * - Realistic mouse coordinates with small variance
 * - Realistic hover / pointerenter events
 * - Realistic click hold duration (70-150ms) between mousedown and mouseup
 * - Native click
 */
async function safeClick(el) {
  if (!el) return false;
  try {
    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        el.scrollIntoView({ block: 'center' });
      }
    }
    // Natural human hesitation before clicking
    await humanDelay(120, 160);

    const rect = el.getBoundingClientRect();
    const clientX = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 10) + (Math.random() * 6 - 3));
    const clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 10) + (Math.random() * 6 - 3));

    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX + 30,
      screenY: clientY + 60,
    };

    // 1. Natural hover events
    try { el.dispatchEvent(new MouseEvent('mousemove', opts)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerenter', opts)); } catch {}

    await humanDelay(40, 60);

    // 2. Press down
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}

    // Realistic click hold duration (70-150ms)
    await humanDelay(70, 80);

    // 3. Release & trigger click
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch {}
    try { el.dispatchEvent(new CustomEvent('tap', opts)); } catch {}

    if (typeof el.click === 'function') {
      el.click();
    }
    return true;
  } catch {
    return false;
  }
}

function dispatchFullClick(el) {
  if (!el) return false;
  try {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch {}
    try { el.dispatchEvent(new CustomEvent('tap', opts)); } catch {}
    if (typeof el.click === 'function') {
      el.click();
    }
    return true;
  } catch {
    return false;
  }
}

const COMMON_LANG_CODES = {
  'english': 'en',
  'japanese': 'ja',
  'spanish': 'es',
  'arabic': 'ar',
  'french': 'fr',
  'german': 'de',
  'italian': 'it',
  'portuguese': 'pt',
  'russian': 'ru',
  'chinese': 'zh',
  'chinese (simplified)': 'zh-Hans',
  'chinese (traditional)': 'zh-Hant',
  'korean': 'ko',
  'hindi': 'hi',
  'turkish': 'tr',
  'dutch': 'nl',
  'polish': 'pl',
  'swedish': 'sv',
  'vietnamese': 'vi',
  'indonesian': 'id',
  'ukrainian': 'uk',
  'thai': 'th',
};

function resolveLanguageCode(name, translationLanguages) {
  if (!name) return 'en';
  const cleanName = name.replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
  if (Array.isArray(translationLanguages)) {
    const found = translationLanguages.find((tl) => {
      const tlName = (tl.languageName?.simpleText || (tl.languageName?.runs && tl.languageName.runs[0]?.text) || '').toLowerCase().trim();
      return tlName === cleanName || tl.languageCode?.toLowerCase() === cleanName;
    });
    if (found && found.languageCode) return found.languageCode;
  }
  return COMMON_LANG_CODES[cleanName] || cleanName.slice(0, 2) || 'en';
}

function getVideoTitle() {
  const titleEl =
    document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
    document.querySelector('h1.title yt-formatted-string') ||
    document.querySelector('h1 yt-formatted-string') ||
    document.querySelector('meta[name="title"]');

  if (titleEl) {
    return (titleEl.textContent || titleEl.getAttribute('content') || '').trim();
  }
  return (document.title || '').replace(/ - YouTube$/, '').trim() || 'YouTube Video';
}

function getTranscriptSegments() {
  const hosts = document.querySelectorAll(
    'transcript-segment-view-model, ' +
    '.ytwTranscriptSegmentViewModelHost, ' +
    'ytd-transcript-segment-renderer'
  );
  if (hosts && hosts.length > 0) return Array.from(hosts);

  return Array.from(document.querySelectorAll(
    'ytd-transcript-segment-renderer .segment, ' +
    '[class*="ytwTranscriptSegmentViewModelHost"], ' +
    '[class*="TranscriptSegmentViewModel"]'
  ));
}

function getTranscriptPanel() {
  const expanded = document.querySelector(
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"][target-id*="transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"][target-id*="Transcript"]'
  );
  if (expanded) return expanded;

  return document.querySelector(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-transcript"], ' +
    '#panels ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ' +
    'ytd-transcript-renderer, ' +
    'ytd-transcript-search-panel-renderer'
  );
}

function ensureTranscriptTabActive() {
  const panel = getTranscriptPanel();
  const root = panel || document;
  const transcriptChips = root.querySelectorAll(
    'button[role="tab"], yt-chip-cloud-chip-renderer button, .ytChipShapeButtonReset, [role="tab"]'
  );
  for (const chip of transcriptChips) {
    const label = (chip.getAttribute('aria-label') || chip.textContent || '').trim().toLowerCase();
    if (
      label.includes('transcript') ||
      label.includes('transcripción') ||
      label.includes('transcrição') ||
      label.includes('transkript') ||
      label.includes('transcription') ||
      label.includes('расшифровка')
    ) {
      if (chip.getAttribute('aria-selected') === 'false') {
        dispatchFullClick(chip);
        return true;
      }
    }
  }
  return false;
}

function isTranscriptPanelOpen() {
  const panel = getTranscriptPanel();
  const hasSegments = getTranscriptSegments().length > 0;
  if (!panel) return hasSegments;
  const visibility = panel.getAttribute('visibility');
  if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN') return false;
  if (panel.hasAttribute('hidden') || panel.style.display === 'none') return false;
  return visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' || hasSegments;
}

function hasPanelUnavailableMessage() {
  const panel = getTranscriptPanel();
  if (!panel) return false;
  const msg = panel.querySelector('ytd-message-renderer #message, #message.ytd-message-renderer, .ytd-message-renderer');
  if (msg && msg.textContent && /unavailable|no transcript|disabled/i.test(msg.textContent)) {
    return true;
  }
  return false;
}

function hasInternalErrorMessage() {
  const panel = getTranscriptPanel();
  if (!panel) return false;
  const text = (panel.textContent || '').toLowerCase();
  return text.includes('internal error') || text.includes('try refreshing');
}

/**
 * Locate YouTube's transcript close button.
 * Specifically handles YouTube's exact button markup:
 * <yt-button-shape><button class="ytSpecButtonShapeNextHost ... " aria-label="Close">
 * with SVG path d="M17.293 5.293 12 10.586 6.707 5.293a1 1 0 10-1.414 1.414L10.586 12l-5.293 5.293a1 1 0 001.414 1.414L12 13.414l5.293 5.293a1 1 0 001.414-1.414L13.414 12l5.293-5.293a1 1 0 10-1.414-1.414Z"
 */
function findTranscriptCloseButton() {
  const panel = getTranscriptPanel();
  const searchRoots = panel ? [panel, document] : [document];

  for (const root of searchRoots) {
    // 1. Precise SVG path matching YouTube's close icon geometry
    const svgPaths = root.querySelectorAll('svg path');
    for (const p of svgPaths) {
      const d = p.getAttribute('d') || '';
      if (d.includes('M17.293 5.293') || d.includes('17.293 5.293') || d.startsWith('M17.293 5.293')) {
        const btn = p.closest('button') || p.closest('yt-button-shape') || p.closest('yt-icon-button');
        if (btn) return btn;
      }
    }

    // 2. yt-button-shape with button[aria-label="Close"]
    const shapeBtn = root.querySelector(
      'yt-button-shape button[aria-label="Close"], ' +
      'button.ytSpecButtonShapeNextHost[aria-label="Close"], ' +
      'yt-button-shape button[aria-label*="Close" i], ' +
      'button.ytSpecButtonShapeNextHost[aria-label*="Close" i], ' +
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] button[aria-label="Close"], ' +
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #visibility-button button, ' +
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #dismiss-button button'
    );
    if (shapeBtn) return shapeBtn;
  }

  // 3. Fallback to generic engagement panel close selectors
  const fallbackSelectors = [
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #visibility-button button',
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #dismiss-button button',
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] yt-icon-button#visibility-button',
    'button[aria-label*="Close transcript" i]',
    'button[aria-label="Close"]',
    '#visibility-button button'
  ];
  for (const sel of fallbackSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      return btn;
    }
  }

  return null;
}

async function closeTranscriptPanel() {
  try {
    const btn = findTranscriptCloseButton();
    if (btn) {
      await safeClick(btn);
      await humanDelay(400, 300);
      return true;
    }
  } catch (err) {
    console.warn('[YT Transcript Copier] closeTranscriptPanel error:', err);
  }
  return false;
}

/**
 * Checks with high certainty if a transcript is known to exist for this video.
 * Uses 7 independent signals:
 * 1. window.ytInitialPlayerResponse captionTracks
 * 2. window.__ytcAllTracks list
 * 3. ytplayer config args raw_player_response
 * 4. Embedded script tags with captionTracks
 * 5. YouTube video description transcript section renderer
 * 6. Transcript engagement panel renderer in DOM
 * 7. Active transcript button in description or page
 */
function isSureTranscriptExists() {
  try {
    // 1. window.ytInitialPlayerResponse captionTracks
    const playerCaptions = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(playerCaptions) && playerCaptions.length > 0) return true;

    // 2. Already tracked available languages
    if (Array.isArray(window.__ytcAllTracks) && window.__ytcAllTracks.length > 0) return true;

    // 3. Raw player response args
    const rawArg = window.ytplayer?.config?.args?.raw_player_response;
    if (rawArg?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length > 0) return true;

    // 4. Script tags containing captionTracks
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const c = script.textContent || '';
      if (c.includes('captionTracks') && (c.includes('baseUrl') || c.includes('languageCode'))) {
        return true;
      }
    }

    // 5. YouTube video description transcript section renderer
    if (document.querySelector('ytd-video-description-transcript-section-renderer')) return true;

    // 6. Transcript engagement panel in DOM
    if (document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ' +
      'ytd-transcript-renderer, ' +
      'ytd-transcript-search-panel-renderer'
    )) {
      return true;
    }

    // 7. Transcript button found via query
    if (queryTranscriptButton()) return true;
  } catch {}
  return false;
}

async function resetAndClickAwayFromTranscript() {
  try {
    // 1. Close transcript panel using the exact close button
    await closeTranscriptPanel();
    await humanDelay(500, 300);

    // 2. Click somewhere neutral on the YouTube page to clear focus and reset Polymer state
    const neutralSelectors = [
      '#movie_player',
      'ytd-watch-metadata #title',
      '#above-the-fold h1',
      '#description',
      '#primary-inner'
    ];
    for (const sel of neutralSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        await safeClick(el);
        await humanDelay(400, 250);
        break;
      }
    }
  } catch (err) {
    console.warn('[YT Transcript Copier] resetAndClickAwayFromTranscript error:', err);
  }
}

function parseDomSegments() {
  const segments = getTranscriptSegments();
  if (!segments || !segments.length) return null;

  const lines = [];
  segments.forEach((seg) => {
    const timestampEl = seg.querySelector(
      '.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, [class*="Timestamp"], .yt-core-attributed-string'
    );
    const textEl = seg.querySelector(
      '.segment-text, .ytAttributedStringHost, span[role="text"], [class*="segment-text"], span'
    );

    const timestamp = timestampEl ? timestampEl.textContent.trim() : '';
    const text = textEl ? decodeHtmlEntities(textEl.textContent) : '';

    if (text) {
      lines.push({ timestamp, text });
    }
  });

  if (!lines.length) return null;

  return {
    success: true,
    strategyUsed: 'dom-panel',
    videoTitle: getVideoTitle(),
    videoUrl: window.location.href || '',
    lines,
  };
}

function isOurExtensionButton(el) {
  if (!el) return false;
  return !!(
    el.id === 'ytc-transcript-quick-button' ||
    el.closest('#ytc-transcript-quick-button') ||
    el.classList.contains('ytc-quick-btn') ||
    el.closest('.ytc-transcript-btn-wrapper')
  );
}

function queryTranscriptButton() {
  const selectors = [
    'ytd-video-description-transcript-section-renderer #primary-button button',
    'ytd-video-description-transcript-section-renderer button',
    'ytd-structured-description-content-renderer ytd-video-description-transcript-section-renderer button',
    'ytd-video-description-transcript-section-renderer yt-button-shape button',
    '#structured-description ytd-video-description-transcript-section-renderer button',
    'ytd-button-renderer[aria-label*="transcript" i] button',
    'button[aria-label*="show transcript" i]',
    'button[aria-label*="transcript" i]:not(.ytc-quick-btn)',
  ];

  for (const sel of selectors) {
    const candidates = document.querySelectorAll(sel);
    for (const btn of candidates) {
      if (!isOurExtensionButton(btn) && btn.offsetParent !== null) {
        return btn;
      }
    }
  }

  const transcriptKeywords = [
    'show transcript', 'transcript', 'mostrar transcripción', 'transcripción',
    'mostrar transcrição', 'transcrição', 'transkripsiyonu göster', 'transkript',
    'afficher la transcription', 'transcription', 'transkript anzeigen',
    'mostra trascrizione', 'показать расшифровку', 'расшифровка', 'عرض تفاصيل النص',
    'تفريغ نصي', 'نص الفيديو', 'ट्रांसक्रिप्ट', '文字起こし', '스크립트', '显示文字记录', '逐字稿'
  ];

  const allButtons = Array.from(document.querySelectorAll('button, tp-yt-paper-button'));
  for (const kw of transcriptKeywords) {
    const btn = allButtons.find((b) => {
      if (isOurExtensionButton(b)) return false;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').trim().toLowerCase();
      return aria.includes(kw) || text === kw || text.includes(kw);
    });
    if (btn) return btn;
  }
  return null;
}

async function expandVideoDescription() {
  const expanders = [
    '#expand.ytd-text-inline-expander',
    'ytd-text-inline-expander #expand',
    '#description-inline-expander #expand',
    '#description-inline-expander',
    '#expand.ytd-structured-description-content-renderer',
    'tp-yt-paper-button#expand',
    '#expand-sizer',
    '#bottom-row #expand',
    'ytd-watch-metadata #description',
    '#description',
  ];

  for (const sel of expanders) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      try {
        el.click();
        return true;
      } catch {}
    }
  }
  return false;
}

/**
 * Actively opens the YouTube transcript section via:
 * 1. Native "Show transcript" button in description
 * 2. Expanding collapsed description box if hidden
 * 3. YouTube "More actions" ("...") overflow menu
 * 4. Direct engagement panel visibility activation
 */
async function openTranscriptSection() {
  // If already open and has segments, return true immediately
  if (isTranscriptPanelOpen()) {
    ensureTranscriptTabActive();
    return true;
  }

  // Method 1: Check if "Show transcript" button is already visible in DOM
  let btn = queryTranscriptButton();
  if (btn) {
    try {
      btn.click();
      await delay(250);
      ensureTranscriptTabActive();
      if (isTranscriptPanelOpen()) return true;
    } catch {}
  }

  // Method 2: Expand description box, then search for transcript button
  await expandVideoDescription();
  await delay(250);

  btn = queryTranscriptButton();
  if (btn) {
    try {
      btn.click();
      await delay(350);
      ensureTranscriptTabActive();
      if (isTranscriptPanelOpen()) return true;
    } catch {}
  }

  // Method 3: Use YouTube's "More actions" ("...") overflow menu in the action bar
  const moreActionsBtn = document.querySelector(
    '#top-level-buttons-computed yt-button-shape button[aria-label*="actions" i], ' +
    '#top-level-buttons-computed button[aria-label*="actions" i], ' +
    '#top-level-buttons-computed yt-icon-button#button[aria-label*="actions" i], ' +
    '#top-level-buttons-computed button[aria-label="More actions"], ' +
    '#top-level-buttons-computed button[aria-label="More"], ' +
    'ytd-watch-metadata #top-level-buttons-computed ytd-menu-renderer yt-icon-button, ' +
    '#top-level-buttons-computed ytd-menu-renderer yt-icon-button'
  );

  if (moreActionsBtn && !isOurExtensionButton(moreActionsBtn)) {
    try {
      moreActionsBtn.click();
      await delay(200);

      const menuItems = Array.from(document.querySelectorAll(
        'ytd-menu-service-item-renderer, tp-yt-paper-item, ytd-menu-navigation-item-renderer, ytd-menu-popup-renderer yt-formatted-string, ytd-menu-popup-renderer tp-yt-paper-item'
      ));

      const transcriptItem = menuItems.find((item) => {
        if (isOurExtensionButton(item)) return false;
        const text = (item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('transcript') || aria.includes('transcript') ||
               text.includes('transcrip') || text.includes('расшифровк') ||
               text.includes('transkript');
      });

      if (transcriptItem) {
        transcriptItem.click();
        await delay(350);
        ensureTranscriptTabActive();
        if (isTranscriptPanelOpen()) return true;
      } else {
        // Dismiss overflow menu if transcript item wasn't present
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    } catch {}
  }

  // Method 4: Directly ensure YouTube's engagement panel visibility attribute is expanded
  const panel = getTranscriptPanel();
  if (panel) {
    try {
      panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      panel.removeAttribute('hidden');
      panel.style.display = '';
      ensureTranscriptTabActive();
    } catch {}
  }

  return isTranscriptPanelOpen();
}

async function findShowTranscriptButton() {
  let btn = queryTranscriptButton();
  if (btn) return btn;

  await expandVideoDescription();
  await delay(250);

  return queryTranscriptButton();
}

/**
 * Closes the transcript segment from YouTube's exact close button,
 * clicks away to neutral space to clear Polymer state, then reopens it.
 */
async function closeAndReopenTranscript() {
  await waitForVideoElementLoaded();

  // 1. Close transcript segment from the exact YouTube close button
  await closeTranscriptPanel();
  await humanDelay(700, 400);

  // 2. Click neutral space to reset focus and Polymer component state
  await resetAndClickAwayFromTranscript();
  await humanDelay(800, 400);

  // 3. Locate the transcript button and re-open it
  const btn = await findShowTranscriptButton();
  if (btn) {
    await safeClick(btn);
    await humanDelay(800, 400);
    ensureTranscriptTabActive();
    return true;
  }
  return false;
}

async function switchDomTranscriptLanguage(languageName, trackIndex) {
  // 1. If transcript panel is not open on YouTube, open it first
  if (!isTranscriptPanelOpen()) {
    const showBtn = await findShowTranscriptButton();
    if (showBtn) {
      await safeClick(showBtn);
      await humanDelay(900, 400);
    }
  }
  ensureTranscriptTabActive();

  // 2. Locate footer and the exact expand icon specified by the user:
  // <yt-icon id="label-icon" icon="expand" class="style-scope yt-dropdown-menu">
  const footerSelectors = [
    'ytd-transcript-footer-renderer',
    'ytd-transcript-search-panel-renderer #footer',
    '#panels ytd-transcript-footer-renderer',
    '[target-id*="transcript"] #footer',
    '#footer.ytd-transcript-search-panel-renderer',
    '#footer'
  ];

  let footer = null;
  let labelIcon = null;
  const findStart = Date.now();
  while (Date.now() - findStart < 3500) {
    for (const sel of footerSelectors) {
      footer = document.querySelector(sel);
      if (footer) break;
    }
    labelIcon = footer?.querySelector('#label-icon, yt-icon#label-icon, yt-icon[icon="expand"]') ||
                document.querySelector('ytd-transcript-footer-renderer #label-icon, #label-icon, yt-icon[icon="expand"]');
    if (labelIcon) break;
    await humanDelay(200, 100);
  }

  const labelButton = labelIcon?.closest('tp-yt-paper-button#label, tp-yt-paper-button, [role="button"]') ||
                      footer?.querySelector('tp-yt-paper-button#label, .dropdown-trigger, [slot="dropdown-trigger"]') ||
                      document.querySelector('ytd-transcript-footer-renderer tp-yt-paper-button#label');
  const menuBtn = footer?.querySelector('tp-yt-paper-menu-button#menu-button, tp-yt-paper-menu-button') ||
                  document.querySelector('ytd-transcript-footer-renderer tp-yt-paper-menu-button');

  // Check if dropdown is already open
  const checkDropdownOpen = () => {
    const dd = footer?.querySelector('tp-yt-iron-dropdown#dropdown, tp-yt-iron-dropdown') ||
               document.querySelector('ytd-transcript-footer-renderer tp-yt-iron-dropdown');
    return dd && dd.style.display !== 'none' && !dd.hasAttribute('aria-hidden');
  };

  // Click the <yt-icon id="label-icon"> to open dropdown with human pacing
  if (!checkDropdownOpen()) {
    if (labelIcon) {
      await safeClick(labelIcon);
    } else if (labelButton) {
      await safeClick(labelButton);
    }
    if (menuBtn && typeof menuBtn.open === 'function') {
      try { menuBtn.open(); } catch {}
    }
    await humanDelay(800, 400);
  }

  // 3. Locate listbox inside dropdown, polling up to 3500ms
  let listbox = null;
  let items = [];
  const listboxStart = Date.now();
  while (Date.now() - listboxStart < 3500) {
    listbox = footer?.querySelector('tp-yt-paper-listbox#menu, tp-yt-paper-listbox') ||
              document.querySelector('tp-yt-iron-dropdown tp-yt-paper-listbox#menu, tp-yt-iron-dropdown tp-yt-paper-listbox, ytd-transcript-footer-renderer tp-yt-paper-listbox');
    
    if (listbox) {
      items = Array.from(listbox.querySelectorAll('a.yt-simple-endpoint, tp-yt-paper-item, [role="option"]'));
      const containerItems = items.filter((el) => el.tagName.toLowerCase() === 'a' || !el.closest('a.yt-simple-endpoint'));
      if (containerItems.length > 0) items = containerItems;
      items = items.filter((it) => !/^(top|newest|top comments|newest first)/i.test((it.textContent || '').trim()));
      if (items.length > 0) break;
    }

    // If still not open after 900ms, retry clicking label-icon with human delay
    if (Date.now() - listboxStart > 900 && !checkDropdownOpen()) {
      if (labelIcon) await safeClick(labelIcon);
      else if (labelButton) await safeClick(labelButton);
      await humanDelay(400, 200);
    }

    await humanDelay(350, 150);
  }

  if (!items || items.length === 0) return null;

  // 4. Find the target element for the selected language
  const targetLower = (languageName || '').trim().toLowerCase();
  const targetBase = targetLower.replace(/\s*\([^)]*\)/g, '').trim();
  let targetEl = null;

  if (targetLower) {
    targetEl = items.find((it) => {
      const nameEl = it.querySelector('.item') || it.querySelector('tp-yt-paper-item-body') || it;
      const txt = (nameEl.textContent || '').trim().toLowerCase();
      return txt === targetLower;
    });

    if (!targetEl) {
      targetEl = items.find((it) => {
        const nameEl = it.querySelector('.item') || it.querySelector('tp-yt-paper-item-body') || it;
        const txt = (nameEl.textContent || '').trim().toLowerCase();
        const txtBase = txt.replace(/\s*\([^)]*\)/g, '').trim();
        return txtBase === targetBase || txt.includes(targetBase) || targetBase.includes(txtBase);
      });
    }
  }

  if (!targetEl && typeof trackIndex === 'number' && items[trackIndex]) {
    targetEl = items[trackIndex];
  }

  if (!targetEl) return null;

  // Check if target is already active
  const isAlreadySelected = targetEl.classList.contains('iron-selected') || targetEl.getAttribute('aria-selected') === 'true';
  const currentLabel = (footer?.querySelector('#label-text')?.textContent || '').trim().toLowerCase();
  if (isAlreadySelected && targetBase && currentLabel.includes(targetBase)) {
    const parsed = parseDomSegments();
    if (parsed && parsed.lines && parsed.lines.length > 0) {
      return parsed.lines;
    }
  }

  // Sample old transcript to detect segment update
  const getSample = () => Array.from(document.querySelectorAll(
    'transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost, ytd-transcript-segment-renderer, .segment'
  )).slice(0, 8).map((s) => (s.textContent || '').trim()).join(' ');

  const oldSample = getSample();

  // 5. Click target option with human pacing and composed events
  const paperItem = targetEl.querySelector('tp-yt-paper-item') || (targetEl.tagName?.toLowerCase() === 'tp-yt-paper-item' ? targetEl : null);
  const anchor = targetEl.closest('a') || (targetEl.tagName?.toLowerCase() === 'a' ? targetEl : null);
  const textItem = targetEl.querySelector('.item') || targetEl;

  await safeClick(anchor || paperItem || textItem || targetEl);
  await humanDelay(600, 300);

  const itemIndex = items.indexOf(targetEl);
  if (itemIndex >= 0 && listbox) {
    try {
      if (typeof listbox.select === 'function') listbox.select(itemIndex);
      else if (listbox.selected !== undefined) listbox.selected = itemIndex;
      listbox.dispatchEvent(new CustomEvent('iron-select', {
        bubbles: true,
        composed: true,
        detail: { item: targetEl }
      }));
      listbox.dispatchEvent(new CustomEvent('selected-changed', {
        bubbles: true,
        composed: true,
        detail: { value: itemIndex }
      }));
    } catch {}
  }

  // Close dropdown cleanly after natural pause
  setTimeout(() => {
    if (menuBtn && typeof menuBtn.close === 'function') {
      try { menuBtn.close(); } catch {}
    }
  }, 600);

  // 6. Poll for YouTube to re-render transcript segments in the new language
  const pollStart = Date.now();
  while (Date.now() - pollStart < 12000) {
    await humanDelay(450, 200);
    const newSample = getSample();
    const contentChanged = newSample && oldSample && newSample !== oldSample;

    if (contentChanged || (!oldSample && newSample)) {
      // Allow extra settling time for entire transcript list to populate
      await humanDelay(600, 300);
      const parsed = parseDomSegments();
      if (parsed && parsed.lines && parsed.lines.length > 0) {
        return parsed.lines;
      }
    }
  }

  // Final fallback check
  const finalParsed = parseDomSegments();
  return finalParsed?.lines || null;
}

// Persistent message listener for language switching
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && !window.__ytcLangListenerAttached) {
  window.__ytcLangListenerAttached = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'switch-transcript-language') {
      (async () => {
        const { trackIndex, baseUrl, languageName } = msg;

        // 1. Direct DOM segment language switch on YouTube
        try {
          const lines = await switchDomTranscriptLanguage(languageName, trackIndex);
          if (lines && lines.length > 0) {
            sendResponse({ success: true, lines, captionLanguage: languageName });
            return;
          }
        } catch (domErr) {
          console.warn('[YT Transcript Copier] DOM language switch error:', domErr);
        }

        // 2. Direct URL fetch fallback (only for authentic separate track URLs, never forged tlang)
        let targetUrl = baseUrl || (window.__ytcAllTracks && window.__ytcAllTracks[trackIndex]?.baseUrl);
        if (targetUrl && !targetUrl.includes('&tlang=')) {
          try {
            const res = await fetch(targetUrl);
            if (res.ok) {
              const text = await res.text();
              const lines = parseCaptionTrackXmlOrJson(text);
              if (lines && lines.length > 0) {
                sendResponse({ success: true, lines, captionLanguage: languageName });
                return;
              }
            }
          } catch {}
        }

        sendResponse({ success: false, error: 'switch-failed' });
      })();
      return true; // async response
    }

    if (msg.action === 'copy-to-clipboard') {
      (async () => {
        try {
          await navigator.clipboard.writeText(msg.text);
          sendResponse({ success: true });
        } catch {
          try {
            const textarea = document.createElement('textarea');
            textarea.value = msg.text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            sendResponse({ success: ok });
          } catch {
            sendResponse({ success: false });
          }
        }
      })();
      return true;
    }

    if (msg.action === 'close-and-reopen-transcript') {
      (async () => {
        try {
          const ok = await closeAndReopenTranscript();
          sendResponse({ success: ok });
        } catch {
          sendResponse({ success: false });
        }
      })();
      return true;
    }
  });
}

// Global extraction function callable via executeScript func
window.__ytcExtractTranscript = async function(requestedLang) {
  const telemetry = {
    strategy1_playerData: 'NOT_TRIED',
    strategy2_embeddedJson: 'NOT_TRIED',
    strategy3_domPanel: 'NOT_TRIED',
  };

  try {



    function parseAvailableTracks(captionTracks, activeBaseUrl) {
      if (!Array.isArray(captionTracks)) return [];
      return captionTracks.map((t, idx) => {
        let name = '';
        if (t.name) {
          name = t.name.simpleText || (t.name.runs && t.name.runs[0]?.text) || '';
        }
        const isAuto = t.kind === 'asr' || (name && name.toLowerCase().includes('auto'));
        const code = t.languageCode || 'unknown';
        if (!name) {
          name = isAuto ? `${code} (auto-generated)` : code;
        }
        return {
          code,
          name,
          isAuto,
          vssId: t.vssId || '',
          baseUrl: t.baseUrl || '',
          trackIndex: idx,
          isSelected: activeBaseUrl ? t.baseUrl === activeBaseUrl : idx === 0,
        };
      });
    }

    function extractDomLanguages() {
      const listbox = document.querySelector(
        'ytd-transcript-footer-renderer tp-yt-paper-listbox#menu, ' +
        'ytd-transcript-footer-renderer tp-yt-paper-listbox, ' +
        'ytd-transcript-search-panel-renderer tp-yt-paper-listbox#menu, ' +
        'ytd-transcript-search-panel-renderer tp-yt-paper-listbox, ' +
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] tp-yt-paper-listbox#menu, ' +
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] tp-yt-paper-listbox'
      );
      if (!listbox || typeof listbox.querySelectorAll !== 'function') return [];

      let items = listbox.querySelectorAll('a.yt-simple-endpoint');
      if (!items || items.length === 0) {
        items = listbox.querySelectorAll('tp-yt-paper-item');
      }
      if (!items || items.length === 0) {
        items = listbox.querySelectorAll('[role="option"]');
      }
      const langs = [];
      items.forEach((item, idx) => {
        const textEl =
          item.querySelector('.item.style-scope.yt-dropdown-menu') ||
          item.querySelector('.item') ||
          item.querySelector('tp-yt-paper-item-body') ||
          item;

        let rawName = '';
        if (textEl.childNodes && textEl.childNodes.length > 0) {
          for (const node of textEl.childNodes) {
            if (node.nodeType === 3 && node.textContent.trim()) {
              rawName = node.textContent.trim();
              break;
            }
          }
        }
        if (!rawName) rawName = (textEl.textContent || '').trim();
        if (!rawName) return;

        // Blacklist comments sort options
        if (/^(top|newest|top comments|newest first|más recientes|principales|populari|populaires|recents)$/i.test(rawName.trim())) {
          return;
        }

        const isSelected =
          item.classList.contains('iron-selected') ||
          item.getAttribute('aria-selected') === 'true' ||
          Boolean(item.querySelector && item.querySelector('[aria-selected="true"]'));

        const isAuto = /auto-generated|automatique|automático/i.test(rawName);
        const code = rawName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) || 'lang';

        langs.push({
          code,
          name: rawName,
          isAuto,
          trackIndex: idx,
          isSelected,
        });
      });
      return langs;
    }



    function finalizeDomResult(segmentsResult) {
      if (!segmentsResult) return null;

      const domLanguages = extractDomLanguages() || [];

      let playerCaptions = null;
      try {
        playerCaptions = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer;
      } catch {}

      let rawTracks = playerCaptions?.captionTracks;
      let transLangs = playerCaptions?.translationLanguages;

      if (!rawTracks || !rawTracks.length) {
        try {
          for (const script of document.querySelectorAll('script')) {
            const c = script.textContent || '';
            if (!c.includes('captionTracks')) continue;
            const m = c.match(/"captionTracks":\s*(\[\s*\{.*\}\s*\])/s) || c.match(/"captionTracks":\s*(\[\{.*?\}\])/s);
            if (m) {
              const trs = JSON.parse(m[1]);
              if (Array.isArray(trs) && trs.length > 0) {
                rawTracks = trs;
                break;
              }
            }
          }
        } catch {}
      }

      const playerTracks = Array.isArray(rawTracks) ? parseAvailableTracks(rawTracks, null) : [];
      const baseTrack = playerTracks.find((t) => t.code === 'en') || playerTracks[0];

      let availableLanguages = [];
      if (domLanguages.length > 0) {
        const trackMap = new Map();
        playerTracks.forEach((pt) => {
          if (pt.name) {
            trackMap.set(pt.name.toLowerCase().trim(), pt);
            const baseName = pt.name.replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
            if (baseName && !trackMap.has(baseName)) {
              trackMap.set(baseName, pt);
            }
          }
          if (pt.code) {
            trackMap.set(pt.code.toLowerCase().trim(), pt);
          }
        });

        availableLanguages = domLanguages.map((dl, idx) => {
          const dlName = dl.name || '';
          const dlKey = dlName.toLowerCase().trim();
          const dlBaseKey = dlName.replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
          const matched = trackMap.get(dlKey) || trackMap.get(dlBaseKey);
          if (matched && matched.baseUrl) {
            return {
              ...dl,
              baseUrl: matched.baseUrl,
              vssId: matched.vssId || '',
              code: matched.code || 'unknown',
            };
          }

          // Generate translation url with &tlang=
          const langCode = resolveLanguageCode(dlName, transLangs);
          let baseUrl = '';
          if (baseTrack && baseTrack.baseUrl) {
            try {
              const u = new URL(baseTrack.baseUrl);
              u.searchParams.set('tlang', langCode);
              baseUrl = u.toString();
            } catch {}
          }

          return {
            ...dl,
            baseUrl,
            vssId: `t.${langCode}`,
            code: langCode,
          };
        });
      } else if (playerTracks.length > 0) {
        availableLanguages = playerTracks;
      } else {
        availableLanguages = domLanguages;
      }

      // Detect currently selected language from requestedLang or DOM footer if present
      const currentDomLangName = (document.querySelector('ytd-transcript-footer-renderer #label-text, #footer #label-text')?.textContent || '').trim();
      let selectedLang = null;
      if (requestedLang) {
        const reqLower = requestedLang.toLowerCase().trim();
        selectedLang = availableLanguages.find((l) => (l.name && l.name.toLowerCase().trim() === reqLower) || (l.code && l.code.toLowerCase().trim() === reqLower));
      }
      if (!selectedLang && currentDomLangName) {
        const curLower = currentDomLangName.toLowerCase().trim();
        selectedLang = availableLanguages.find((l) => l.name && l.name.toLowerCase().trim() === curLower);
      }
      if (!selectedLang) {
        selectedLang = availableLanguages.find((l) => l.isSelected);
      }
      if (!selectedLang && availableLanguages.length > 0) {
        selectedLang = availableLanguages[0];
        selectedLang.isSelected = true;
      }

      availableLanguages.forEach((l) => {
        l.isSelected = (l === selectedLang);
      });

      window.__ytcAllTracks = availableLanguages;

      return {
        ...segmentsResult,
        captionLanguage: selectedLang ? selectedLang.name : (requestedLang || currentDomLangName || 'Default'),
        availableLanguages,
        allTracks: availableLanguages,
        telemetry,
      };
    }

    // ==================================================================
    // STRATEGY 1: Tab Window Memory Inspection (ytInitialPlayerResponse)
    // ==================================================================
    async function extractFromWindowPlayerResponse() {
      try {
        let playerResponse = window.ytInitialPlayerResponse;

        if (!playerResponse && window.ytplayer && window.ytplayer.config) {
          playerResponse = window.ytplayer.config.args?.raw_player_response;
        }

        if (!playerResponse) {
          telemetry.strategy1_playerData = 'NO_PLAYER_RESPONSE';
          return null;
        }

        const captionTracks =
          playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!captionTracks || !captionTracks.length) {
          telemetry.strategy1_playerData = 'NO_TRACKS';
          return null;
        }

        const activeDomLang = (document.querySelector('ytd-transcript-footer-renderer #label-text, #footer #label-text')?.textContent || '').trim();
        const desiredLang = requestedLang || activeDomLang;

        let track = null;
        let isTranslation = false;
        let transLangCode = null;

        if (desiredLang) {
          const desiredLower = desiredLang.toLowerCase();
          track = captionTracks.find((t) => {
            const tName = (t.name?.simpleText || (t.name?.runs && t.name.runs[0]?.text) || '').toLowerCase();
            return tName === desiredLower || t.languageCode.toLowerCase() === desiredLower;
          });
          if (!track) {
            const transLangs = playerResponse?.captions?.playerCaptionsTracklistRenderer?.translationLanguages;
            transLangCode = resolveLanguageCode(desiredLang, transLangs);
            if (transLangCode) {
              isTranslation = true;
            }
          }
        }

        if (isTranslation) {
          // Note: Appending &tlang= to timedtext URLs without YouTube HMAC signatures returns English.
          // Fall through to Strategy 3 (DOM Panel) where YouTube natively renders translated segments.
          telemetry.strategy1_playerData = 'TRANSLATION_REQUIRES_DOM';
          return null;
        }

        if (!track) {
          track =
            captionTracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
            captionTracks.find((t) => t.languageCode === 'en') ||
            captionTracks[0];
        }

        if (!track || !track.baseUrl) {
          telemetry.strategy1_playerData = 'INVALID_TRACK_URL';
          return null;
        }

        let fetchUrl = track.baseUrl;
        let langName = track.name?.simpleText || (track.name?.runs && track.name.runs[0]?.text) || track.languageCode || 'English';

        const res = await fetch(fetchUrl);
        if (!res.ok) {
          telemetry.strategy1_playerData = `FETCH_FAILED_${res.status}`;
          return null;
        }

        const capText = await res.text();
        if (!capText || capText.trim().length === 0) {
          telemetry.strategy1_playerData = 'EMPTY_RESPONSE';
          return null;
        }

        const lines = parseCaptionTrackXmlOrJson(capText);
        if (!lines || !lines.length) {
          telemetry.strategy1_playerData = 'PARSER_FAILED';
          return null;
        }

        const availableLanguages = parseAvailableTracks(captionTracks, track.baseUrl);
        window.__ytcAllTracks = availableLanguages;

        telemetry.strategy1_playerData = 'SUCCESS';
        return {
          success: true,
          strategyUsed: 'player-data',
          videoTitle: getVideoTitle(),
          videoUrl,
          captionLanguage: langName,
          availableLanguages,
          allTracks: availableLanguages,
          lines,
          telemetry,
        };
      } catch (err) {
        telemetry.strategy1_playerData = `EXCEPTION_${err && err.message ? err.message : 'ERR'}`;
        return null;
      }
    }

    // ==================================================================
    // STRATEGY 2: Embedded Script Tag Parsing
    // ==================================================================
    async function extractFromEmbeddedScripts() {
      try {
        const scripts = document.querySelectorAll('script');
        let captionUrl = null;
        let lang = 'unknown';
        let matchedTracks = null;
        let selectedTrack = null;

        for (const script of scripts) {
          const content = script.textContent || '';
          if (!content.includes('captionTracks')) continue;

          const match =
            content.match(/"captionTracks":\s*(\[\s*\{.*\}\s*\])/s) ||
            content.match(/"captionTracks":\s*(\[\{.*?\}\])/s);

          if (match) {
            try {
              const tracks = JSON.parse(match[1]);
              let tr = null;
              if (requestedLang) {
                const reqLower = requestedLang.toLowerCase().trim();
                tr = tracks.find((t) => {
                  const tName = (t.name?.simpleText || (t.name?.runs && t.name.runs[0]?.text) || '').toLowerCase();
                  return tName === reqLower || t.languageCode?.toLowerCase() === reqLower;
                });
              }
              if (!tr && !requestedLang) {
                tr =
                  tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
                  tracks.find((t) => t.languageCode === 'en') ||
                  tracks[0];
              }
              if (tr && tr.baseUrl) {
                captionUrl = tr.baseUrl;
                lang = tr.name?.simpleText || (tr.name?.runs && tr.name.runs[0]?.text) || tr.languageCode || 'unknown';
                matchedTracks = tracks;
                selectedTrack = tr;
                break;
              }
            } catch {}
          }
        }

        if (!captionUrl) return null;

        const res = await fetch(captionUrl);
        if (!res.ok) return null;

        const capText = await res.text();
        const lines = parseCaptionTrackXmlOrJson(capText);
        if (!lines || !lines.length) return null;

        const availableLanguages = parseAvailableTracks(matchedTracks, captionUrl);
        window.__ytcAllTracks = availableLanguages;

        return {
          success: true,
          strategyUsed: 'embedded-json',
          videoTitle: getVideoTitle(),
          videoUrl,
          captionLanguage: lang,
          availableLanguages,
          allTracks: availableLanguages,
          lines,
        };
      } catch {
        return null;
      }
    }

    // ==================================================================
    // ==================================================================
    // STRATEGY 3: Native DOM Panel Scraper Fallback
    // ==================================================================
    async function extractFromDomPanel() {
      // 1. Immediately open the transcript section
      await openTranscriptSection();

      // Ensure Transcript chip is active if modern YouTube has Chapters/Transcript subheader
      ensureTranscriptTabActive();

      // Check if already open and populated with text for the requested language
      const currentDomLang = (document.querySelector('ytd-transcript-footer-renderer #label-text, #footer #label-text')?.textContent || '').trim().toLowerCase();
      const reqBase = requestedLang ? requestedLang.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim() : '';
      const matchesRequested = !requestedLang || (currentDomLang && currentDomLang.includes(reqBase));

      if (matchesRequested && isTranscriptPanelOpen()) {
        const result = parseDomSegments();
        if (result && result.lines && result.lines.length > 0) {
          telemetry.strategy3_domPanel = 'SUCCESS';
          return finalizeDomResult(result);
        }
      }

      // If a specific language is requested and does not match current DOM footer, switch it!
      if (requestedLang) {
        const activeDomFooter = (document.querySelector('ytd-transcript-footer-renderer #label-text, #footer #label-text')?.textContent || '').trim().toLowerCase();
        if (!activeDomFooter || !activeDomFooter.includes(reqBase)) {
          try {
            const switchedLines = await switchDomTranscriptLanguage(requestedLang);
            if (switchedLines && switchedLines.length > 0) {
              telemetry.strategy3_domPanel = 'SUCCESS_DOM_SWITCH';
              return finalizeDomResult({ lines: switchedLines, method: 'dom-switch' });
            }
          } catch (switchErr) {
            console.warn('[YT Transcript Copier] DOM switch within extractFromDomPanel failed:', switchErr);
          }
        }
      }

      // Poll for panel segments with responsive timeout up to 6,000ms
      const TIMEOUT_MS = 6000;
      const start = Date.now();
      let reclickAttempted = false;

      while (Date.now() - start < TIMEOUT_MS) {
        ensureTranscriptTabActive();

        // 1. Check if segments are rendered and contain text
        const result = parseDomSegments();
        if (result && result.lines && result.lines.length > 0) {
          telemetry.strategy3_domPanel = 'SUCCESS';
          return finalizeDomResult(result);
        }

        // 2. Early termination if YouTube explicitly says unavailable (no captions exist)
        if (hasPanelUnavailableMessage()) {
          telemetry.strategy3_domPanel = 'PANEL_UNAVAILABLE_MESSAGE';
          return null;
        }

        // 3. Retry opening once after 2.5 seconds if panel hasn't populated
        if (!reclickAttempted && Date.now() - start > 2500 && getTranscriptSegments().length === 0) {
          reclickAttempted = true;
          await openTranscriptSection();
        }

        await delay(250);
      }

      // Final attempt before timeout
      const finalResult = parseDomSegments();
      if (finalResult && finalResult.lines && finalResult.lines.length > 0) {
        telemetry.strategy3_domPanel = 'SUCCESS';
        return finalizeDomResult(finalResult);
      }

      telemetry.strategy3_domPanel = 'TIMEOUT';
      return null;
    }

    // ==================================================================
    // PIPELINE EXECUTION: Strategy 1 -> Strategy 2 -> Strategy 3
    // ==================================================================

    // 0. If the transcript panel is already open with segments on YouTube, prioritize reading the user's active view!
    const activeDomLang = (document.querySelector('ytd-transcript-footer-renderer #label-text, #footer #label-text')?.textContent || '').trim().toLowerCase();
    const reqBase = requestedLang ? requestedLang.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim() : '';
    const activeMatchesRequested = !requestedLang || (activeDomLang && activeDomLang.includes(reqBase));

    if (activeMatchesRequested && isTranscriptPanelOpen() && getTranscriptSegments().length > 0) {
      const activeResult = parseDomSegments();
      if (activeResult && activeResult.lines && activeResult.lines.length > 0) {
        telemetry.strategy3_domPanel = 'SUCCESS_ALREADY_OPEN';
        return finalizeDomResult(activeResult);
      }
    }

    // Try Strategy 1: Tab Window Player Data
    let result = await extractFromWindowPlayerResponse();
    if (result && result.success) return result;

    // Try Strategy 2: Embedded Script Tags
    result = await extractFromEmbeddedScripts();
    if (result && result.success) return result;

    // Try Strategy 3: DOM Panel Scraper
    result = await extractFromDomPanel();
    if (result && result.success) return result;

    // Classify specific failure mode:
    // If timedtext endpoints were present but returned 0 bytes (PoToken attestation soft-block)
    const isAttestationBlock =
      telemetry.strategy1_playerData === 'EMPTY_RESPONSE' ||
      telemetry.strategy2_embeddedJson === 'EMPTY_RESPONSE';

    if (isAttestationBlock) {
      return {
        success: false,
        error: 'attestation-required',
        telemetry,
      };
    }

    // Failure: No captions could be retrieved
    return {
      success: false,
      error: 'no-transcript',
      telemetry,
    };
  } catch (err) {
    return {
      success: false,
      error: 'script-error',
      detail: String(err && err.message ? err.message : err),
      telemetry,
    };
  }
};

// Export helper functions for popup and background scripts
window.__ytcCloseAndReopenTranscript = closeAndReopenTranscript;
window.__ytcIsSureTranscriptExists = isSureTranscriptExists;
window.__ytcCloseTranscriptPanel = closeTranscriptPanel;
window.__ytcOpenTranscriptSection = openTranscriptSection;
})();



