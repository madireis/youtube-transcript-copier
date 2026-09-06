/**
 * YouTube Transcript Copier — Standalone Search & Navigation Engine (v2.4)
 * =======================================================================
 * Pure, deterministic search, snippet extraction, and selection slicing.
 * Zero dependencies — runs in Node.js and modern browsers.
 */

// ---- Text & Unicode Normalization ----
function normalizeForSearch(text) {
  if (!text) return '';
  return text
    // Handle Turkish uppercase dotted I and lowercase dotless i explicitly
    .replace(/\u0130/g, 'i') // Dotted capital I -> i
    .replace(/\u0131/g, 'i') // Dotless lowercase i -> i
    .toLowerCase()
    // Decompose accents/diacritics and strip them (e.g. café -> cafe, über -> uber, ş -> s, ğ -> g, ç -> c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Normalize Arabic presentation forms and alefs
    .replace(/[\u0622\u0623\u0625]/g, '\u0627') // Alif with madda, hamza above/below -> bare alif
    .replace(/\u0649/g, '\u064A') // Alif maqsura -> ya
    .replace(/\u0629/g, '\u0647') // Ta marbuta -> ha
    .replace(/[\u064B-\u065F]/g, ''); // Strip Arabic tashkeel (diacritics)
}

function stripPunctuation(text) {
  if (!text) return '';
  // Replace non-word/non-whitespace punctuation with spaces to allow flexible matching
  return text.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]\\]/g, ' ').replace(/\s{2,}/g, ' ');
}

// ---- Search Execution ----
function searchTranscript(segments, query) {
  if (!Array.isArray(segments)) return [];
  const trimmedQ = (query || '').trim();

  if (!trimmedQ) {
    return segments.map((seg, idx) => ({
      index: idx,
      timestamp: seg.timestamp,
      startSeconds: seg.startSeconds !== undefined ? seg.startSeconds : 0,
      text: seg.text,
      matchCount: 0,
      hasMatch: false,
      snippet: seg.text,
      matchPositions: [],
    }));
  }

  const normQ = normalizeForSearch(trimmedQ);
  const puncCleanQ = stripPunctuation(normQ).trim();
  const results = [];

  segments.forEach((seg, idx) => {
    const rawText = seg.text || '';
    const normText = normalizeForSearch(rawText);
    const puncCleanText = stripPunctuation(normText);

    // Search both normalized text and punctuation-clean text
    let hasMatch = false;
    let matchCount = 0;
    const matchPositions = [];

    // 1. Direct normalized check
    let pos = normText.indexOf(normQ);
    while (pos !== -1) {
      hasMatch = true;
      matchCount++;
      matchPositions.push({ start: pos, length: normQ.length });
      pos = normText.indexOf(normQ, pos + 1);
    }

    // 2. Fallback punctuation-tolerant match if direct check found nothing
    if (!hasMatch && puncCleanQ.length > 1) {
      let pPos = puncCleanText.indexOf(puncCleanQ);
      while (pPos !== -1) {
        hasMatch = true;
        matchCount++;
        pPos = puncCleanText.indexOf(puncCleanQ, pPos + 1);
      }
    }

    if (hasMatch) {
      results.push({
        index: idx,
        timestamp: seg.timestamp,
        startSeconds: seg.startSeconds !== undefined ? seg.startSeconds : 0,
        text: rawText,
        matchCount,
        hasMatch: true,
        snippet: createSnippet(rawText, trimmedQ),
        matchPositions,
      });
    }
  });

  return results;
}

// ---- Snippet Generator ----
function createSnippet(text, query, contextWords = 4) {
  if (!query || !text) return text;
  const words = text.split(/\s+/);
  const lowerQ = query.toLowerCase();

  let matchWordIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].toLowerCase().includes(lowerQ)) {
      matchWordIdx = i;
      break;
    }
  }

  if (matchWordIdx === -1) return text;

  const start = Math.max(0, matchWordIdx - contextWords);
  const end = Math.min(words.length, matchWordIdx + contextWords + 1);

  const prefix = start > 0 ? '...' : '';
  const suffix = end < words.length ? '...' : '';

  return prefix + words.slice(start, end).join(' ') + suffix;
}

// ---- Slicing & Selection Tools ----
function sliceSegment(segments, index) {
  if (!segments || index < 0 || index >= segments.length) return null;
  return [segments[index]];
}

function sliceFrom(segments, startIndex) {
  if (!segments || startIndex < 0 || startIndex >= segments.length) return [];
  return segments.slice(startIndex);
}

function sliceRange(segments, indices) {
  if (!segments || !Array.isArray(indices)) return [];
  const indexSet = new Set(indices.map(Number).filter((n) => !isNaN(n) && n >= 0 && n < segments.length));
  const sorted = Array.from(indexSet).sort((a, b) => a - b);
  return sorted.map((idx) => segments[idx]);
}

function sliceRangeBiDirectional(segments, indexA, indexB) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const start = Math.max(0, Math.min(indexA, indexB));
  const end = Math.min(segments.length - 1, Math.max(indexA, indexB));
  return segments.slice(start, end + 1);
}

function formatSelection(segments, { includeTimestamps = true, delimiter = '\n' } = {}) {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((seg) => {
      const text = (seg.text || '').trim();
      return includeTimestamps && seg.timestamp ? `[${seg.timestamp}] ${text}` : text;
    })
    .join(delimiter);
}

// ---- Playback & Marks Tools ----
function findActiveSegment(segments, currentSeconds) {
  if (!Array.isArray(segments) || segments.length === 0 || typeof currentSeconds !== 'number') {
    return -1;
  }
  let activeIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    const sec = segments[i].startSeconds !== undefined ? segments[i].startSeconds : 0;
    if (sec <= currentSeconds) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}

function filterMarkedSegments(segments, markedIndices) {
  if (!Array.isArray(segments) || !markedIndices) return [];
  const set = markedIndices instanceof Set ? markedIndices : new Set(markedIndices);
  return segments.filter((_, idx) => set.has(idx));
}

function exportMarksSummary(segments, markedIndices, metadata = {}) {
  const marked = filterMarkedSegments(segments, markedIndices);
  if (marked.length === 0) return '';
  let out = '';
  if (metadata.title) {
    out += `# 📌 Marked Moments: ${metadata.title}\n\n`;
  }
  marked.forEach((seg) => {
    out += `⭐ [${seg.timestamp}] ${seg.text.trim()}\n`;
  });
  return out;
}

// ==================================================================
// WORKSPACE STATE MACHINE & STORAGE QUOTA POLICIES (v2.5.1)
// ==================================================================

const VIEW_MODE = Object.freeze({
  ALL: 'ALL',
  SEARCH: 'SEARCH',
  BOOKMARKS: 'BOOKMARKS',
});

const PLAYBACK_MODE = Object.freeze({
  FOLLOW: 'FOLLOW',
  FREE: 'FREE',
});

const SELECTION_MODE = Object.freeze({
  NONE: 'NONE',
  ACTIVE: 'ACTIVE',
});

/**
 * Resolves current playback state against full segments and filtered visible set.
 * Returns whether the playing segment is visible in the current view mode.
 */
function resolvePlaybackState(segments, currentSeconds, visibleSegmentIndices) {
  const fullIndex = findActiveSegment(segments, currentSeconds);
  if (fullIndex === -1) {
    return {
      fullIndex: -1,
      isVisible: false,
      visibleIndex: -1,
      timestamp: null,
      text: null,
    };
  }

  const activeSeg = segments[fullIndex];
  const isSet = visibleSegmentIndices instanceof Set;
  const isVisible = visibleSegmentIndices
    ? (isSet ? visibleSegmentIndices.has(fullIndex) : visibleSegmentIndices.includes(fullIndex))
    : true;

  let visibleIndex = -1;
  if (isVisible && Array.isArray(visibleSegmentIndices)) {
    visibleIndex = visibleSegmentIndices.indexOf(fullIndex);
  }

  return {
    fullIndex,
    isVisible,
    visibleIndex,
    timestamp: activeSeg.timestamp || '',
    text: activeSeg.text || '',
  };
}

/**
 * Storage Quota & Integrity Management
 */
function sanitizeWorkspaces(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.id !== 'string' || !item.id.trim()) return false;
    if (!Array.isArray(item.lines) || item.lines.length === 0) return false;
    // Normalize properties
    item.videoTitle = typeof item.videoTitle === 'string' ? item.videoTitle.trim() : 'Untitled Transcript';
    item.videoUrl = typeof item.videoUrl === 'string' ? item.videoUrl.trim() : '';
    item.savedAt = typeof item.savedAt === 'number' ? item.savedAt : Date.now();
    item.marks = Array.isArray(item.marks) ? item.marks.filter((n) => typeof n === 'number') : [];
    item.selectedIndices = Array.isArray(item.selectedIndices) ? item.selectedIndices.filter((n) => typeof n === 'number') : [];
    return true;
  });
}

function estimateStorageBytes(data) {
  try {
    const jsonStr = JSON.stringify(data);
    return Buffer.byteLength(jsonStr, 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Prunes workspaces list when exceeding maxLimit.
 * Policy:
 *   1. Unstarred workspaces (marks.length === 0) are evicted oldest-first.
 *   2. If all remaining have marks, the oldest marked workspace is evicted.
 */
function pruneWorkspaces(list, maxLimit = 30) {
  const sanitized = sanitizeWorkspaces(list);
  if (sanitized.length <= maxLimit) {
    return sanitized;
  }

  // Work on a copy sorted by savedAt ascending (oldest first)
  let items = [...sanitized];

  while (items.length > maxLimit) {
    // Find first unstarred item (from oldest to newest)
    const unstarredIdx = items.findIndex((w) => !w.marks || w.marks.length === 0);
    if (unstarredIdx !== -1) {
      items.splice(unstarredIdx, 1);
    } else {
      // All have marks; evict oldest
      items.shift();
    }
  }

  return items;
}

module.exports = {
  normalizeForSearch,
  stripPunctuation,
  searchTranscript,
  createSnippet,
  sliceSegment,
  sliceFrom,
  sliceRange,
  sliceRangeBiDirectional,
  formatSelection,
  findActiveSegment,
  filterMarkedSegments,
  exportMarksSummary,
  VIEW_MODE,
  PLAYBACK_MODE,
  SELECTION_MODE,
  resolvePlaybackState,
  sanitizeWorkspaces,
  estimateStorageBytes,
  pruneWorkspaces,
};

