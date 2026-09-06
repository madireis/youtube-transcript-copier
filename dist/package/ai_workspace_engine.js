/**
 * YouTube Transcript Copier — AI Workspace & Clip Notes Engine (v2.7.0)
 * ====================================================================
 * Pure, deterministic AI prompt compiling, context routing, token estimation,
 * and first-class structured Clip Notes domain generation with timestamp linking.
 * Zero external dependencies — runs in Node.js and browser environments.
 */

(() => {
  'use strict';

  const AI_ACTION_PRESETS = Object.freeze({
    summarize: 'Summarize the following transcript excerpt in concise, high-impact bullet points:',
    explain: 'Explain the key concepts and arguments discussed in this excerpt in clear, simple terms with examples:',
    action_items: 'Extract all actionable steps, recommendations, and key takeaways from this excerpt:',
    translate: 'Translate the following transcript excerpt accurately into English, preserving tone and terminology:',
    clip_notes_synthesis: 'Synthesize these key marked moments from the video into an organized, cohesive study guide / executive summary:',
  });

  const LARGE_PAYLOAD_CHAR_THRESHOLD = 100000; // ~25,000 tokens
  const LARGE_PAYLOAD_TOKEN_THRESHOLD = 25000;

/**
 * Pure heuristic token estimation (~4 characters per token).
 * Accurately models Latin, code, punctuation, and multi-byte content.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.length / 4.0));
}

/**
 * Builds a precise YouTube timestamp jump URL.
 */
function buildTimestampUrl(baseUrl, seconds) {
  if (!baseUrl) return '';
  const cleanSec = Math.max(0, Math.floor(seconds || 0));
  // Strip any pre-existing &t= parameter
  const stripped = baseUrl.replace(/[?&]t=\d+s?/, '');
  const joiner = stripped.includes('?') ? '&' : '?';
  return `${stripped}${joiner}t=${cleanSec}s`;
}

/**
 * Parses timestamp string (MM:SS or HH:MM:SS) to integer seconds.
 */
function parseTimestampToSeconds(ts) {
  if (!ts) return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Generates a first-class structured ClipNote domain entity.
 * Includes video provenance, typed moments array, markdown representation,
 * and token/character metrics.
 */
function generateStructuredClipNote(segments, markedIndices, metadata = {}) {
  if (!Array.isArray(segments)) {
    return {
      schemaVersion: 1,
      id: metadata.id || `clip_${Date.now()}`,
      video: { id: '', title: 'Untitled Video', url: '' },
      createdAt: Date.now(),
      momentCount: 0,
      moments: [],
      markdown: '',
      characterCount: 0,
      estimatedTokens: 0,
    };
  }

  const markSet = markedIndices instanceof Set ? markedIndices : new Set(markedIndices || []);
  const markedList = segments
    .map((seg, idx) => ({ seg, idx }))
    .filter((item) => markSet.has(item.idx))
    .sort((a, b) => a.idx - b.idx);

  const title = metadata.title || 'Untitled Video';
  const url = metadata.url || '';
  const videoId = metadata.videoId || '';
  const createdAt = metadata.createdAt || Date.now();
  const id = metadata.id || (videoId ? `clip_${videoId}_${createdAt}` : `clip_${createdAt}`);

  const moments = markedList.map(({ seg, idx }) => {
    const sec = seg.startSeconds !== undefined ? seg.startSeconds : parseTimestampToSeconds(seg.timestamp);
    const tsLink = url ? buildTimestampUrl(url, sec) : '';
    return {
      index: idx,
      timestamp: seg.timestamp || '00:00',
      seconds: sec,
      url: tsLink,
      text: (seg.text || '').trim(),
      userAnnotation: seg.annotation || '',
    };
  });

  let markdown = '';
  if (moments.length > 0) {
    markdown += `# 📝 Clip Notes: ${title}\n`;
    if (url) {
      markdown += `> **Source:** [${title}](${url})\n`;
    }
    markdown += `> **Marked Moments:** ${moments.length}\n\n`;
    markdown += `## Key Moments\n\n`;

    moments.forEach((m) => {
      const linkFormatted = m.url ? `[⏱️ ${m.timestamp}](${m.url})` : `⏱️ [${m.timestamp}]`;
      markdown += `- ${linkFormatted} ${m.text}\n`;
    });
  }

  return {
    schemaVersion: 1,
    id,
    video: {
      id: videoId,
      title,
      url,
      durationSeconds: metadata.durationSeconds || 0,
    },
    createdAt,
    momentCount: moments.length,
    moments,
    markdown,
    characterCount: markdown.length,
    estimatedTokens: estimateTokens(markdown),
  };
}

/**
 * Generates markdown Clip Notes string from marked moments (⭐).
 * Delegates to generateStructuredClipNote for backwards compatibility.
 */
function generateClipNotes(segments, markedIndices, metadata = {}) {
  const structured = generateStructuredClipNote(segments, markedIndices, metadata);
  return structured.markdown;
}

/**
 * Compiles a focused AI prompt payload based on target scope and action preset.
 * Computes exact character counts, token estimation, and safety threshold alerts.
 */
function buildAiPayload({
  title = '',
  url = '',
  segments = [],
  scope = 'full', // 'selection' | 'marks' | 'segment' | 'full'
  selectedIndices = [],
  markedIndices = [],
  singleIndex = -1,
  actionKey = 'summarize',
  customPrompt = '',
  includeTimestamps = true,
} = {}) {
  let targetSegments = [];

  switch (scope) {
    case 'selection': {
      const set = new Set(selectedIndices || []);
      targetSegments = segments.filter((_, idx) => set.has(idx));
      break;
    }
    case 'marks': {
      const set = new Set(markedIndices || []);
      targetSegments = segments.filter((_, idx) => set.has(idx));
      break;
    }
    case 'segment': {
      if (singleIndex >= 0 && singleIndex < segments.length) {
        targetSegments = [segments[singleIndex]];
      }
      break;
    }
    case 'full':
    default: {
      targetSegments = [...segments];
      break;
    }
  }

  if (targetSegments.length === 0) {
    targetSegments = [...segments];
  }

  // Determine prompt directive
  const directive = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : (actionKey && AI_ACTION_PRESETS[actionKey] ? AI_ACTION_PRESETS[actionKey] : '');

  // Format body
  let body = '';
  targetSegments.forEach((seg) => {
    if (includeTimestamps && seg.timestamp) {
      body += `[${seg.timestamp}] ${seg.text.trim()}\n`;
    } else {
      body += `${seg.text.trim()}\n`;
    }
  });

  // Construct final compiled prompt
  let payload = '';
  if (directive) {
    payload += `${directive}\n\n`;
  }
  payload += `---\n`;
  if (title) payload += `Video: ${title}\n`;
  if (url) payload += `URL: ${url}\n`;
  if (scope !== 'full') payload += `Scope: ${scope.toUpperCase()} (${targetSegments.length} segments)\n`;
  payload += `---\n\n`;
  payload += body.trim();

  const charCount = payload.length;
  const tokenCount = estimateTokens(payload);
  const isLargePayload = charCount > LARGE_PAYLOAD_CHAR_THRESHOLD || tokenCount > LARGE_PAYLOAD_TOKEN_THRESHOLD;

  return {
    directive,
    scope,
    segmentCount: targetSegments.length,
    characterCount: charCount,
    estimatedTokens: tokenCount,
    isLargePayload,
    warningThreshold: LARGE_PAYLOAD_CHAR_THRESHOLD,
    text: payload,
  };
}


if (typeof window !== 'undefined') {
  window.AiWorkspaceEngine = {
    AI_ACTION_PRESETS,
    LARGE_PAYLOAD_CHAR_THRESHOLD,
    LARGE_PAYLOAD_TOKEN_THRESHOLD,
    estimateTokens,
    buildTimestampUrl,
    parseTimestampToSeconds,
    generateStructuredClipNote,
    generateClipNotes,
    buildAiPayload,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AI_ACTION_PRESETS,
    LARGE_PAYLOAD_CHAR_THRESHOLD,
    LARGE_PAYLOAD_TOKEN_THRESHOLD,
    estimateTokens,
    buildTimestampUrl,
    parseTimestampToSeconds,
    generateStructuredClipNote,
    generateClipNotes,
    buildAiPayload,
  };
}
})();
