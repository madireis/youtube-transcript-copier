/**
 * YouTube Transcript Copier — Standalone Extraction Engine
 * ========================================================
 * Extracted directly from production code (background.js + popup.js)
 * Zero dependencies — runs on Node.js 18+ native fetch.
 *
 * This file is TEST INFRASTRUCTURE ONLY — it does NOT ship with the extension.
 */

// ---- HTML Entity Decoding (from content.js:15-26) ----
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

  // Second pass for double-escaped entities (e.g. &amp;amp;, &amp;quot;)
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

// ---- Timestamp Helpers ----
function parseSecondsToTimestamp(startSec) {
  const totalSec = Math.floor(startSec || 0);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseTimestampToSeconds(ts) {
  if (!ts) return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function formatSecondsToSRT(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

function formatSecondsToVTT(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}.000`;
}

// ---- Caption Parser (JSON3 + XML) — from background.js:277-334 ----
function parseCaptionText(text) {
  const lines = [];

  // Try JSON3 parsing first
  try {
    const json = JSON.parse(text);
    if (json.events && Array.isArray(json.events)) {
      for (const event of json.events) {
        if (!event.segs) continue;
        const lineText = event.segs.map((s) => s.utf8 || '').join('').trim();
        if (!lineText || lineText === '\n') continue;

        const startMs = event.tStartMs || 0;
        const totalSec = Math.floor(startMs / 1000);
        const timestamp = parseSecondsToTimestamp(totalSec);

        lines.push({ timestamp, startSeconds: totalSec, text: decodeHtmlEntities(lineText) });
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

// ---- Fetch Transcript — from background.js:339-425 ----
async function fetchTranscriptForVideo(videoId) {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      return { videoId, success: false, error: 'fetch-failed', detail: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Check for unavailable / private / removed videos
    if (html.includes('"playabilityStatus":{"status":"ERROR"') ||
        html.includes('"playabilityStatus":{"status":"UNPLAYABLE"') ||
        html.includes('"reason":"Video unavailable"') ||
        html.includes('"reason":"This video is private"') ||
        html.includes('"reason":"This video has been removed"')) {
      return { videoId, success: false, error: 'video-unavailable' };
    }

    // Check for age-restricted
    if (html.includes('"reason":"Sign in to confirm your age"') ||
        html.includes('"LOGIN_REQUIRED"')) {
      return { videoId, success: false, error: 'age-restricted' };
    }

    // Extract captionTracks using bracket-balanced JSON extraction
    let captionTracks = null;

    // Find the start of captionTracks array and extract balanced JSON
    const ctIndex = html.indexOf('"captionTracks":');
    if (ctIndex !== -1) {
      const arrStart = html.indexOf('[', ctIndex);
      if (arrStart !== -1) {
        let depth = 0;
        let arrEnd = -1;
        for (let i = arrStart; i < html.length && i < arrStart + 50000; i++) {
          if (html[i] === '[') depth++;
          else if (html[i] === ']') {
            depth--;
            if (depth === 0) { arrEnd = i + 1; break; }
          }
        }
        if (arrEnd > arrStart) {
          try {
            captionTracks = JSON.parse(html.substring(arrStart, arrEnd));
          } catch {
            // Continue to pattern 2
          }
        }
      }
    }

    // Pattern 2: Full ytInitialPlayerResponse
    if (!captionTracks || !captionTracks.length) {
      const playerMatch =
        html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script>)/s) ||
        html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);

      if (playerMatch) {
        try {
          const playerResponse = JSON.parse(playerMatch[1]);
          captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        } catch {}
      }
    }

    if (!captionTracks || captionTracks.length === 0) {
      return { videoId, success: false, error: 'no-captions-available' };
    }

    // Prefer English or first track
    const track = captionTracks.find((t) => t.languageCode === 'en') || captionTracks[0];
    const captionUrl = track.baseUrl;
    if (!captionUrl) return { videoId, success: false, error: 'invalid-caption-url' };

    // Fetch raw captionUrl
    const capRes = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!capRes.ok) {
      return { videoId, success: false, error: 'caption-fetch-failed', detail: `HTTP ${capRes.status}` };
    }

    const capText = await capRes.text();
    let lines = parseCaptionText(capText);

    if (lines.length > 0) {
      const titleMatch = html.match(/<title>(.+?)<\/title>/);
      let videoTitle = titleMatch
        ? titleMatch[1].replace(/ - YouTube$/, '').trim()
        : `Video ${videoId}`;

      const availableTracks = captionTracks.map(t => ({
        languageCode: t.languageCode,
        name: t.name?.simpleText || t.name?.runs?.[0]?.text || '',
        kind: t.kind || 'standard',
        isTranslatable: !!t.isTranslatable,
      }));

      return {
        videoId,
        success: true,
        strategyUsed: 'background-fetch',
        videoTitle,
        videoUrl: watchUrl,
        lines,
        captionLanguage: track.languageCode || 'unknown',
        captionKind: track.kind || 'standard',
        availableTracks,
      };
    }

    // If native timedtext returned empty (e.g. YouTube PoToken / exp=xpe soft-block),
    // fallback to yt-dlp to obtain the authenticated/clean caption URL!
    const ytdlpResult = await fetchWithYtDlp(videoId, watchUrl);
    if (ytdlpResult && ytdlpResult.success) {
      return ytdlpResult;
    }

    return { videoId, success: false, error: 'empty-captions' };
  } catch (err) {
    // Attempt yt-dlp fallback on exception
    const ytdlpResult = await fetchWithYtDlp(videoId, `https://www.youtube.com/watch?v=${videoId}`);
    if (ytdlpResult && ytdlpResult.success) {
      return ytdlpResult;
    }
    return { videoId, success: false, error: 'fetch-exception', detail: String(err && err.message ? err.message : err) };
  }
}

/**
 * Fallback extractor using yt-dlp metadata to bypass YouTube PoToken / exp=xpe soft blocks
 */
async function fetchWithYtDlp(videoId, watchUrl) {
  const { execSync } = require('child_process');
  try {
    const stdout = execSync(`yt-dlp -j --skip-download --no-warnings "https://www.youtube.com/watch?v=${videoId}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const data = JSON.parse(stdout);
    const subs = data.subtitles || {};
    const autos = data.automatic_captions || {};

    let trackUrl = null;
    let lang = 'unknown';

    // Prioritize English manual subtitles, then first manual subtitle, then auto captions
    const enSubKey = Object.keys(subs).find(k => k.startsWith('en'));
    if (enSubKey && subs[enSubKey]?.[0]?.url) {
      trackUrl = subs[enSubKey][0].url;
      lang = enSubKey;
    } else if (Object.keys(subs).length > 0) {
      const firstKey = Object.keys(subs)[0];
      trackUrl = subs[firstKey]?.[0]?.url;
      lang = firstKey;
    } else if (autos.en?.[0]?.url) {
      trackUrl = autos.en[0].url;
      lang = 'en';
    } else if (Object.keys(autos).length > 0) {
      const firstKey = Object.keys(autos)[0];
      trackUrl = autos[firstKey]?.[0]?.url;
      lang = firstKey;
    }

    if (!trackUrl) {
      return { videoId, success: false, error: 'no-captions-available' };
    }

    const capRes = await fetch(trackUrl);
    if (!capRes.ok) {
      return { videoId, success: false, error: 'caption-fetch-failed', detail: `HTTP ${capRes.status}` };
    }

    const capText = await capRes.text();
    const lines = parseCaptionText(capText);

    if (lines.length === 0) {
      return { videoId, success: false, error: 'empty-captions' };
    }

    return {
      videoId,
      success: true,
      strategyUsed: 'ytdlp-fallback',
      videoTitle: data.title || `Video ${videoId}`,
      videoUrl: watchUrl,
      lines,
      captionLanguage: lang,
      captionKind: subs[lang] ? 'manual' : 'asr',
      availableTracks: [
        ...Object.keys(subs).map(k => ({ languageCode: k, kind: 'manual' })),
        ...Object.keys(autos).map(k => ({ languageCode: k, kind: 'asr' })),
      ],
    };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes('Video unavailable') || msg.includes('Private video') || msg.includes('has been removed')) {
      return { videoId, success: false, error: 'video-unavailable' };
    }
    if (msg.includes('Sign in to confirm your age')) {
      return { videoId, success: false, error: 'age-restricted' };
    }
    return { videoId, success: false, error: 'ytdlp-failed', detail: msg };
  }
}

// ---- Deduplication — from popup.js:645-656 ----
function deduplicateLines(lines) {
  const result = [];
  let prevText = '';
  for (const line of lines) {
    const normalized = line.text.trim().toLowerCase();
    if (normalized !== prevText) {
      result.push(line);
      prevText = normalized;
    }
  }
  return result;
}

// ---- Formatter — from popup.js:659-717 ----
function formatTranscript(data, settings) {
  let lines = [...data.lines];
  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  let output = '';

  if (settings.promptPrepend) {
    output += settings.promptPrepend + '\n\n';
  }

  if (settings.title) {
    output += `📺 ${data.videoTitle}\n${'─'.repeat(40)}\n`;
  }
  if (settings.url && data.videoUrl) {
    output += `🔗 ${data.videoUrl}\n`;
  }
  if (settings.title || (settings.url && data.videoUrl)) {
    output += '\n';
  }

  switch (settings.format) {
    case 'paragraph': {
      const texts = lines.map((l) => l.text.trim());
      output += texts.join(' ') + '\n';
      break;
    }
    case 'compact': {
      const blockSize = 5;
      for (let i = 0; i < lines.length; i += blockSize) {
        const block = lines.slice(i, i + blockSize);
        if (settings.timestamps && block[0]) {
          output += `[${block[0].timestamp}]\n`;
        }
        output += block.map((l) => l.text.trim()).join(' ') + '\n\n';
      }
      break;
    }
    case 'lines':
    default: {
      output += lines
        .map((line) =>
          settings.timestamps
            ? `[${line.timestamp}]  ${line.text}`
            : line.text
        )
        .join('\n');
      output += '\n';
      break;
    }
  }

  return output;
}

// ---- Exporter — from popup.js:922-971 ----
function exportToFormat(data, format, settings) {
  let lines = [...data.lines];
  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  switch (format) {
    case 'srt': {
      let output = '';
      lines.forEach((line, idx) => {
        const startSec = parseTimestampToSeconds(line.timestamp);
        const nextSec = lines[idx + 1] ? parseTimestampToSeconds(lines[idx + 1].timestamp) : startSec + 4;
        output += `${idx + 1}\n${formatSecondsToSRT(startSec)} --> ${formatSecondsToSRT(nextSec)}\n${line.text.trim()}\n\n`;
      });
      return output.trim();
    }
    case 'vtt': {
      let output = 'WEBVTT\n\n';
      lines.forEach((line, idx) => {
        const startSec = parseTimestampToSeconds(line.timestamp);
        const nextSec = lines[idx + 1] ? parseTimestampToSeconds(lines[idx + 1].timestamp) : startSec + 4;
        output += `${formatSecondsToVTT(startSec)} --> ${formatSecondsToVTT(nextSec)}\n${line.text.trim()}\n\n`;
      });
      return output.trim();
    }
    case 'md': {
      let output = `# ${data.videoTitle || 'YouTube Transcript'}\n\n`;
      if (data.videoUrl) output += `> **Source:** [YouTube Video](${data.videoUrl})\n\n`;
      output += `## Transcript\n\n`;
      lines.forEach((line) => {
        output += settings.timestamps ? `- **\`[${line.timestamp}]\`** ${line.text.trim()}\n` : `- ${line.text.trim()}\n`;
      });
      return output;
    }
    case 'json': {
      return JSON.stringify({ title: data.videoTitle, url: data.videoUrl, transcript: lines }, null, 2);
    }
    case 'csv': {
      let output = 'Timestamp,Text\n';
      lines.forEach((line) => {
        const textEscaped = `"${line.text.replace(/"/g, '""').trim()}"`;
        output += `"${line.timestamp}",${textEscaped}\n`;
      });
      return output;
    }
    case 'txt':
    default:
      return formatTranscript(data, settings);
  }
}

module.exports = {
  decodeHtmlEntities,
  parseSecondsToTimestamp,
  parseTimestampToSeconds,
  formatSecondsToSRT,
  formatSecondsToVTT,
  parseCaptionText,
  fetchTranscriptForVideo,
  deduplicateLines,
  formatTranscript,
  exportToFormat,
};
