/**
 * YouTube Transcript Copier — Background Service Worker
 *
 * Handles:
 * 1. Context menu creation ("Copy Transcript" on YouTube pages).
 * 2. Keyboard shortcut (Ctrl+Shift+Y / Cmd+Shift+Y).
 * 3. On-trigger: reads user settings from chrome.storage.local,
 *    injects content.js, formats using saved settings, and writes
 *    the result to the clipboard via a small injected snippet.
 */

'use strict';

// ---- Side Panel & Context Menu Setup ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'copy-transcript',
    title: 'Copy Transcript',
    contexts: ['page', 'video'],
    documentUrlPatterns: [
      '*://*.youtube.com/watch*',
      '*://*.youtube.com/shorts/*',
    ],
  });

  // Enable Side Panel on action click if supported by browser engine (Chrome 114+)
  if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ---- Default settings (mirrors popup.js) ----
const DEFAULT_SETTINGS = {
  format: 'lines',
  timestamps: true,
  title: true,
  url: false,
  cleanDuplicates: false,
  promptPrepend: '',
};

/** Read user settings from chrome.storage.local, fallback to defaults. */
async function getUserSettings() {
  try {
    const result = await chrome.storage.local.get('userSettings');
    return { ...DEFAULT_SETTINGS, ...(result.userSettings || {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ---- Helpers ----

function isYouTubeVideo(url) {
  if (!url) return false;
  return url.includes('youtube.com/watch') || url.includes('youtube.com/shorts/');
}

function getShortsVideoId(url) {
  if (!url) return null;
  const match = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function getWatchVideoId(url) {
  if (!url) return null;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function getVideoIdFromUrl(url) {
  return getWatchVideoId(url) || getShortsVideoId(url) || null;
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab-load-timeout'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Polls the tab until the YouTube video element and player have loaded:
 * - <video> element exists with readyState >= 1 (HAVE_METADATA) or duration > 0
 * - #movie_player exists and has current videoId loaded
 * - ytd-watch-metadata or title is populated
 */
async function waitForVideoLoadedInTab(tabId, expectedVideoId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: (vid) => {
          const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
          const videoReady = video && (video.readyState >= 1 || video.duration > 0 || video.currentTime > 0);

          const player = document.querySelector('#movie_player');
          let playerReady = false;
          if (player) {
            try {
              if (typeof player.getVideoData === 'function') {
                const data = player.getVideoData();
                playerReady = !vid || data?.video_id === vid;
              } else {
                playerReady = true;
              }
            } catch {
              playerReady = true;
            }
          }

          const hasMetadata = !!document.querySelector('ytd-watch-metadata, #above-the-fold, h1.ytd-watch-metadata, #title h1');

          return {
            isReady: (videoReady || playerReady) && hasMetadata,
            videoReady,
            playerReady,
            hasMetadata,
          };
        },
        args: [expectedVideoId || null],
      });

      const status = checkResults?.[0]?.result;
      if (status && status.isReady) {
        // Video is fully loaded! Add a 800ms stabilization buffer before clicking transcript
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }
    } catch {
      // Tab might still be navigating or executing initial scripts
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Detects if the video in the given tab has reached at least targetSeconds (default 2.0s).
 * Replaces static waiting with real-time playback telemetry.
 * If playback is paused at 0s, initiates a gentle video.play() kickstart.
 * If autoplay is blocked or a preroll delay occurs, gracefully proceeds after timeoutMs.
 */
async function waitForVideoPlaybackSecond(tabId, targetSeconds = 2.0, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (targetSec) => {
          const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
          const player = document.querySelector('#movie_player');

          let curTime = 0;
          if (video && typeof video.currentTime === 'number') {
            curTime = video.currentTime;
          } else if (player && typeof player.getCurrentTime === 'function') {
            try { curTime = player.getCurrentTime() || 0; } catch (e) {}
          }

          // If paused at start, gently attempt play to advance to second 2
          if (video && video.paused && curTime < targetSec) {
            try {
              const playPromise = video.play();
              if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
              }
            } catch (e) {}
          }

          return {
            reached: curTime >= targetSec,
            currentTime: curTime,
            isPaused: video ? video.paused : true,
            hasVideo: !!video,
          };
        },
        args: [targetSeconds],
      });

      const data = res?.[0]?.result;
      if (data && data.reached) {
        // Human-like natural buffer after reaching target second (2s)
        await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
        return { reached: true, currentTime: data.currentTime, elapsedMs: Date.now() - start };
      }
    } catch {
      // Tab may still be transitioning
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Graceful fallback if autoplay blocked or timeout reached
  return { reached: false, timeout: true, elapsedMs: Date.now() - start };
}

// ---- Deduplication ----
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

// ---- Formatting (uses saved settings) ----
function formatTranscript(data, settings) {
  let lines = [...data.lines];
  if (settings.cleanDuplicates) {
    lines = deduplicateLines(lines);
  }

  let output = '';

  // Prompt prepend
  if (settings.promptPrepend) {
    output += settings.promptPrepend + '\n\n';
  }

  // Header
  if (settings.title) {
    output += `📺 ${data.videoTitle}\n${'─'.repeat(40)}\n`;
  }
  if (settings.url && data.videoUrl) {
    output += `🔗 ${data.videoUrl}\n`;
  }
  if (settings.title || (settings.url && data.videoUrl)) {
    output += '\n';
  }

  // Body
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

// ---- Tab Extraction & Recovery Engine (Exact Single Video Pipeline) ----
async function extractTranscriptFromTab(activeTabId, currentUrl, requestedLang = null) {
  const videoId = getVideoIdFromUrl(currentUrl);

  try {
    // 1. Ensure content.js is loaded into the tab (registers window.__ytcExtractTranscript & listeners)
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js'],
    });

    // 2. Invoke extraction via func so Chrome's engine awaits the returned Promise
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: async (lang) => {
        if (typeof window.__ytcExtractTranscript === 'function') {
          return await window.__ytcExtractTranscript(lang);
        }
        return null;
      },
      args: [requestedLang || null],
    });

    let result = results?.[0]?.result;

    // Strategy 4: Background Service Worker Fetch Fallback
    if (!result || !result.success || !result.lines?.length) {
      if (videoId) {
        try {
          const bgRes = await fetchTranscriptForVideo(videoId);
          if (bgRes && bgRes.success && bgRes.lines?.length) {
            result = {
              success: true,
              strategyUsed: 'background-fetch',
              videoTitle: bgRes.videoTitle,
              videoUrl: bgRes.videoUrl,
              lines: bgRes.lines,
              captionLanguage: bgRes.captionLanguage,
              availableLanguages: bgRes.availableLanguages || [],
              allTracks: bgRes.allTracks || [],
            };
          }
        } catch { /* ignore background fallback error */ }
      }
    }

    // Fallback directly to background fetch if in-tab extraction didn't succeed
    if ((!result || !result.success || !result.lines?.length) && videoId) {
      try {
        const bgRes = await fetchTranscriptForVideo(videoId);
        if (bgRes && bgRes.success && bgRes.lines?.length) {
          result = {
            success: true,
            strategyUsed: 'background-fetch',
            videoTitle: bgRes.videoTitle,
            videoUrl: bgRes.videoUrl,
            lines: bgRes.lines,
            captionLanguage: bgRes.captionLanguage,
            availableLanguages: bgRes.availableLanguages || [],
            allTracks: bgRes.allTracks || [],
          };
        }
      } catch { /* ignore */ }
    }

    // Final background fetch fallback check if in-tab retry still failed
    if ((!result || !result.success || !result.lines?.length) && videoId) {
      try {
        const bgRes = await fetchTranscriptForVideo(videoId);
        if (bgRes && bgRes.success && bgRes.lines?.length) {
          result = {
            success: true,
            strategyUsed: 'background-fetch',
            videoTitle: bgRes.videoTitle,
            videoUrl: bgRes.videoUrl,
            lines: bgRes.lines,
            captionLanguage: bgRes.captionLanguage,
            availableLanguages: bgRes.availableLanguages || [],
            allTracks: bgRes.allTracks || [],
          };
        }
      } catch { /* ignore */ }
    }

    return result || { success: false, error: 'extraction-failed' };
  } catch (err) {
    return { success: false, error: 'script-error', detail: String(err) };
  }
}

// ---- Core: extract + format + copy ----
async function copyTranscriptFromTab(tab, requestedLang = null, explicitVideoId = null) {
  if (!tab?.id) {
    return { success: false, error: 'not-youtube' };
  }

  const activeTabId = tab.id;
  let currentUrl = tab.url || '';
  const shortsId = explicitVideoId || getShortsVideoId(currentUrl);

  // High-performance Shorts extraction: Fetch timedtext in background without disrupting the Shorts reel
  if (shortsId) {
    try {
      const bgResult = await fetchTranscriptForVideo(shortsId);
      if (bgResult && bgResult.success && bgResult.lines?.length) {
        const settings = await getUserSettings();
        const formatted = formatTranscript(bgResult, settings);

        // Inject clipboard write
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            func: (text) => {
              navigator.clipboard.writeText(text).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              });
            },
            args: [formatted],
          });
        } catch {}

        return {
          success: true,
          linesCount: bgResult.lines.length,
          videoTitle: bgResult.videoTitle || 'YouTube Short',
          videoUrl: `https://www.youtube.com/shorts/${shortsId}`,
          strategyUsed: 'background-timedtext-direct',
          formatted,
        };
      }
    } catch (err) {
      console.warn('Direct shorts background fetch error, falling back:', err);
    }
  }

  if (!isYouTubeVideo(currentUrl)) {
    return { success: false, error: 'not-youtube' };
  }

  const originalShortsUrl = shortsId
    ? `https://www.youtube.com/shorts/${shortsId}`
    : null;

  // Redirect Shorts → /watch?v= if needed as secondary fallback
  if (shortsId) {
    try {
      currentUrl = `https://www.youtube.com/watch?v=${shortsId}`;
      await chrome.tabs.update(activeTabId, { url: currentUrl });
      await waitForTabLoad(activeTabId, 15000);
      // Wait for video playback to reach second 2 instead of static 15s delay
      await waitForVideoPlaybackSecond(activeTabId, 2.0, 10000);
    } catch (err) {
      return { success: false, error: 'shorts-redirect-failed', detail: String(err) };
    }
  }

  const data = await extractTranscriptFromTab(activeTabId, currentUrl, requestedLang);

  if (!data || !data.success || !data.lines?.length) {
    return { success: false, error: data?.error || 'no-transcript' };
  }

  // Read user's saved settings
  const settings = await getUserSettings();
  const formatted = formatTranscript(data, settings);

  // Inject clipboard write
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (text) => {
        navigator.clipboard.writeText(text).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        });
      },
      args: [formatted],
    });
  } catch {
    // clipboard write failed silently
  }

  // Navigate back to Shorts if we redirected
  if (originalShortsUrl) {
    chrome.tabs.update(activeTabId, { url: originalShortsUrl }).catch(() => {});
  }

  return {
    success: true,
    linesCount: data.lines.length,
    videoTitle: data.videoTitle || 'YouTube Video',
    videoUrl: data.videoUrl || currentUrl,
    strategyUsed: data.strategyUsed || 'tab-runner',
    formatted,
  };
}

// ---- Context Menu Click Handler ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'copy-transcript') return;
  await copyTranscriptFromTab(tab);
});

// ---- Keyboard Shortcut Handler ----
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'copy-transcript') return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs?.[0]) await copyTranscriptFromTab(tabs[0]);
  } catch {
    // silently fail
  }
});

// ==================================================================
// BATCH MODE — Multi-Video Transcript Fetcher
// ==================================================================

const BATCH_LIMIT = 25;
const BATCH_DELAY_MS = 6000; // Calmer, human-like pause between batch videos (avoid bot detection)
const BATCH_JITTER_MS = 4000; // Human variance (total delay between videos: 6s - 10s)

/**
 * Fetch transcript for a single video ID using YouTube's captions/timedtext
 * endpoint via the background service worker fetcher.
 *
 * Pipeline State Machine:
 *   [Fetch Watch Page] → Check Availability (VIDEO_UNAVAILABLE, AGE_RESTRICTED)
 *     → Extract captionTracks (NO_CAPTIONS_AVAILABLE)
 *     → Fetch Timedtext (HTTP 200 with 0 bytes = EMPTY_RESPONSE, suspected attestation)
 *     → Transient Jitter Retry (single 500ms retry)
 *     → 2-Pass HTML Entity Decoding & Newline Sanitization
 *     → SUCCESS
 *
 * Taxonomy Classes:
 *   Class 1 (Video State): VIDEO_UNAVAILABLE, AGE_RESTRICTED, NO_CAPTIONS_AVAILABLE
 *   Class 2 (Transport/Extraction): NETWORK_ERROR, HTTP_ERROR, EMPTY_RESPONSE, PARSE_ERROR
 *   Terminal: SUCCESS
 */
// Universal HTML entity decoder with double-pass support for robust sanitization
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

/**
 * Universal caption response parser (supports both YouTube JSON3 and XML timedtext formats).
 */
function parseCaptionText(text) {
  const lines = [];

  // Try JSON3 parsing first
  try {
    const json = JSON.parse(text);
    if (json.events && Array.isArray(json.events)) {
      for (const event of json.events) {
        if (!event.segs) continue;
        const lineText = decodeHtmlEntities(event.segs.map((s) => s.utf8 || '').join(''));
        if (!lineText) continue;

        const startMs = event.tStartMs || 0;
        const totalSec = Math.floor(startMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        const timestamp = hours > 0
          ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${mins}:${String(secs).padStart(2, '0')}`;

        lines.push({ timestamp, text: lineText });
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
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const timestamp = hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;

    lines.push({ timestamp, text: rawText });
  }

  return lines;
}

/**
 * Fetch transcript for a single video ID.
 */
async function fetchTranscriptForVideo(videoId, trackIndex = null, retryCount = 0) {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      if (retryCount < 1) {
        await new Promise((r) => setTimeout(r, 500));
        return fetchTranscriptForVideo(videoId, trackIndex, retryCount + 1);
      }
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

    // Extract captionTracks using bracket-balanced extraction
    let captionTracks = null;
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
          } catch {}
        }
      }
    }

    // Pattern 2: Full ytInitialPlayerResponse fallback
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

    const availableLanguages = captionTracks.map((t, idx) => {
      let name = '';
      if (t.name) {
        name = t.name.simpleText || (t.name.runs && t.name.runs[0]?.text) || '';
      }
      const isAuto = t.kind === 'asr' || (name && name.toLowerCase().includes('auto'));
      const code = t.languageCode || 'unknown';
      if (!name) name = isAuto ? `${code} (auto-generated)` : code;
      return {
        code,
        name,
        isAuto,
        vssId: t.vssId || '',
        baseUrl: t.baseUrl || '',
        trackIndex: idx,
        isSelected: false,
      };
    });

    let chosenIdx = 0;
    if (typeof trackIndex === 'number' && captionTracks[trackIndex]) {
      chosenIdx = trackIndex;
    } else {
      const enIdx = captionTracks.findIndex((t) => t.languageCode === 'en' && t.kind !== 'asr');
      if (enIdx !== -1) chosenIdx = enIdx;
      else {
        const anyEn = captionTracks.findIndex((t) => t.languageCode === 'en');
        if (anyEn !== -1) chosenIdx = anyEn;
      }
    }

    const track = captionTracks[chosenIdx] || captionTracks[0];
    if (availableLanguages[chosenIdx]) availableLanguages[chosenIdx].isSelected = true;

    const captionUrl = track.baseUrl;
    if (!captionUrl) return { videoId, success: false, error: 'invalid-caption-url' };

    // Fetch raw captionUrl
    const capRes = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!capRes.ok) {
      if (retryCount < 1) {
        await new Promise((r) => setTimeout(r, 500));
        return fetchTranscriptForVideo(videoId, trackIndex, retryCount + 1);
      }
      return { videoId, success: false, error: 'caption-fetch-failed', detail: `HTTP ${capRes.status}` };
    }

    const capText = await capRes.text();

    // Detect YouTube PoToken / exp=xpe soft-block (HTTP 200 with 0 bytes)
    if (!capText || capText.trim().length === 0) {
      return { videoId, success: false, error: 'attestation-required' };
    }

    const lines = parseCaptionText(capText);
    if (lines.length === 0) {
      return { videoId, success: false, error: 'empty-captions' };
    }

    const titleMatch = html.match(/<title>(.+?)<\/title>/);
    let videoTitle = titleMatch
      ? titleMatch[1].replace(/ - YouTube$/, '').trim()
      : `Video ${videoId}`;

    let langName = track.name?.simpleText || (track.name?.runs && track.name.runs[0]?.text) || track.languageCode || 'English';

    return {
      videoId,
      success: true,
      videoTitle,
      videoUrl: watchUrl,
      lines,
      captionLanguage: langName,
      availableLanguages,
      allTracks: availableLanguages,
    };
  } catch (err) {
    return { videoId, success: false, error: 'fetch-exception', detail: String(err && err.message ? err.message : err) };
  }
}

// Batch extraction state machine controller
let batchControlState = {
  isRunning: false,
  isPaused: false,
  isStopped: false,
  pauseResolver: null,
  currentIndex: 0,
  total: 0,
  results: [],
  senderTabId: null,
  autoDownload: false,
};

/**
 * Process a batch of video IDs sequentially.
 * Fast background fetch attempt first -> Tab Runner navigation fallback -> Advances to next video.
 * Supports lifecycle controls: Start, Pause (Stop), Resume (Continue), Stop completely.
 */
async function processBatchExtraction(videoIds, senderTabId, autoDownload = false) {
  const total = videoIds.length;
  const results = [];

  batchControlState = {
    isRunning: true,
    isPaused: false,
    isStopped: false,
    pauseResolver: null,
    currentIndex: 0,
    total,
    results,
    senderTabId,
    autoDownload,
  };

  for (let i = 0; i < total; i++) {
    batchControlState.currentIndex = i;

    // Check if stopped before starting next item
    if (batchControlState.isStopped) {
      break;
    }

    // Check if paused before starting item
    if (batchControlState.isPaused) {
      chrome.runtime.sendMessage({
        action: 'batch-paused',
        current: i,
        total,
        videoId: videoIds[i],
        statusText: `Paused at video ${i + 1} of ${total}. Click Continue to resume.`,
      }).catch(() => {});

      await new Promise((resolve) => {
        batchControlState.pauseResolver = resolve;
      });

      if (batchControlState.isStopped) {
        break;
      }
    }

    const videoId = videoIds[i];

    // Send progress update to popup & overlay
    chrome.runtime.sendMessage({
      action: 'batch-progress',
      current: i + 1,
      total,
      videoId,
      status: 'extracting',
      statusText: `Extracting transcript (${i + 1}/${total})...`,
    }).catch(() => {});

    // Phase 1: Fast background API extraction attempt
    let result = await fetchTranscriptForVideo(videoId);

    // Phase 2: If background fetch fails or returns empty, run Tab Navigation Runner
    if ((!result || !result.success || !result.lines?.length) && senderTabId && !batchControlState.isStopped) {
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        await chrome.tabs.update(senderTabId, { url: watchUrl });
        await waitForTabLoad(senderTabId, 15000);
        // Wait until the video actually loads before injecting content script & opening transcript!
        await waitForVideoLoadedInTab(senderTabId, videoId, 20000);

        // User requirement: Detect if the video is at second 2 before starting the process
        chrome.runtime.sendMessage({
          action: 'batch-progress',
          current: i + 1,
          total,
          videoId,
          status: 'detecting-playback',
          statusText: `Opened video (${i + 1}/${total}). Waiting for playback at second 2...`,
        }).catch(() => {});

        const playback = await waitForVideoPlaybackSecond(senderTabId, 2.0, 12000);
        if (playback.reached) {
          chrome.runtime.sendMessage({
            action: 'batch-progress',
            current: i + 1,
            total,
            videoId,
            status: 'playback-ready',
            statusText: `Second 2 reached (${playback.currentTime ? playback.currentTime.toFixed(1) : 2.0}s). Extracting transcript...`,
          }).catch(() => {});
        } else {
          chrome.runtime.sendMessage({
            action: 'batch-progress',
            current: i + 1,
            total,
            videoId,
            status: 'playback-fallback',
            statusText: `Playback check settled (${i + 1}/${total}). Proceeding to extract transcript...`,
          }).catch(() => {});
        }

        // Human hesitation pause before interacting
        await new Promise((r) => setTimeout(r, 600 + Math.floor(Math.random() * 400)));

        await chrome.scripting.executeScript({
          target: { tabId: senderTabId },
          files: ['content.js'],
        });

        let scriptResults = await chrome.scripting.executeScript({
          target: { tabId: senderTabId },
          func: async () => {
            if (typeof window.__ytcExtractTranscript === 'function') {
              return await window.__ytcExtractTranscript();
            }
            return null;
          },
        });

        let tabData = scriptResults?.[0]?.result;

        // If transcript segment didn't load first time or watchdog triggered (>10s with known transcript), refresh page, close transcript from close button, click away, and reopen!
        if ((!tabData || !tabData.success || !tabData.lines?.length || tabData.error === 'needs-page-refresh' || tabData.isSureTranscriptExists || tabData.telemetry?.isSureTranscriptExists) && !batchControlState.isStopped) {
          chrome.runtime.sendMessage({
            action: 'batch-progress',
            current: i + 1,
            total,
            videoId,
            status: 'recovering',
            statusText: `Reloading page (${i + 1}/${total})...`,
          }).catch(() => {});

          await chrome.tabs.reload(senderTabId);
          await waitForTabLoad(senderTabId, 15000);
          // Wait until video is loaded after page reload before reopening transcript
          await waitForVideoLoadedInTab(senderTabId, videoId, 20000);

          // Detect video playback reaching second 2 after reload
          chrome.runtime.sendMessage({
            action: 'batch-progress',
            current: i + 1,
            total,
            videoId,
            status: 'detecting-playback',
            statusText: `Page reloaded (${i + 1}/${total}). Waiting for playback at second 2...`,
          }).catch(() => {});
          await waitForVideoPlaybackSecond(senderTabId, 2.0, 12000);

          await chrome.scripting.executeScript({
            target: { tabId: senderTabId },
            files: ['content.js'],
          });

          // Close transcript segment from close button if open or stuck, click away, and re-open it!
          await chrome.scripting.executeScript({
            target: { tabId: senderTabId },
            func: async () => {
              if (typeof window.__ytcCloseAndReopenTranscript === 'function') {
                await window.__ytcCloseAndReopenTranscript();
              }
            },
          });

          // Human settling pause after reopening panel
          await new Promise((r) => setTimeout(r, 900 + Math.floor(Math.random() * 500)));

          scriptResults = await chrome.scripting.executeScript({
            target: { tabId: senderTabId },
            func: async () => {
              if (typeof window.__ytcExtractTranscript === 'function') {
                return await window.__ytcExtractTranscript();
              }
              return null;
            },
          });
          tabData = scriptResults?.[0]?.result;
        }

        if (tabData && tabData.success && tabData.lines?.length) {
          result = {
            videoId,
            success: true,
            videoTitle: tabData.videoTitle || `Video ${videoId}`,
            videoUrl: watchUrl,
            lines: tabData.lines,
            strategyUsed: tabData.strategyUsed || 'tab-runner',
          };
        }
      } catch (err) {
        // Tab runner navigation failed — keep previous error result
      }
    }

    results.push(result);
    batchControlState.results = results;

    // Send individual result update
    chrome.runtime.sendMessage({
      action: 'batch-video-result',
      current: i + 1,
      total,
      result,
    }).catch(() => {});

    // Rate limiting delay with anti-bot jitter (skip on last item or if stopped)
    if (i < total - 1 && !batchControlState.isStopped) {
      // Check if user requested pause between videos
      if (batchControlState.isPaused) {
        chrome.runtime.sendMessage({
          action: 'batch-paused',
          current: i + 1,
          total,
          videoId: videoIds[i + 1],
          statusText: `Paused. Next video: ${i + 2} of ${total}. Click Continue to resume.`,
        }).catch(() => {});

        await new Promise((resolve) => {
          batchControlState.pauseResolver = resolve;
        });

        if (batchControlState.isStopped) {
          break;
        }
      }

      const delayWithJitter = BATCH_DELAY_MS + Math.floor(Math.random() * BATCH_JITTER_MS);
      await new Promise((r) => setTimeout(r, delayWithJitter));
    }
  }

  const isStoppedEarly = batchControlState.isStopped;
  batchControlState.isRunning = false;
  batchControlState.isPaused = false;
  batchControlState.isStopped = false;

  // Send final completion / stopped message
  chrome.runtime.sendMessage({
    action: isStoppedEarly ? 'batch-stopped' : 'batch-complete',
    total,
    stopped: isStoppedEarly,
    successCount: results.filter((r) => r.success).length,
    failCount: results.filter((r) => !r.success).length,
    results,
  }).catch(() => {});

  // Trigger download directly from background service worker if requested via overlay
  const successResults = results.filter((r) => r.success);
  if (autoDownload && successResults.length > 0) {
    triggerBackgroundBatchDownload(successResults);
  }

  return results;
}

/**
 * Format and download batch transcripts directly from background service worker.
 */
function triggerBackgroundBatchDownload(successResults) {
  let merged = '';
  successResults.forEach((r, idx) => {
    merged += `${'═'.repeat(50)}\n`;
    merged += `📺 ${r.videoTitle}\n`;
    merged += `🔗 ${r.videoUrl}\n`;
    merged += `${'─'.repeat(50)}\n\n`;
    
    r.lines.forEach((line) => {
      merged += `[${line.timestamp}] ${line.text}\n`;
    });
    
    if (idx < successResults.length - 1) merged += '\n\n';
  });

  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(merged)}`;
  const filename = `batch_transcripts_${successResults.length}_videos.txt`;

  if (chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true,
    });
  }
}

// ---- Message Handler for Batch Operations ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'batch-extract-start') {
    let videoIds = msg.videoIds || [];

    // Safety cap
    const overLimit = videoIds.length > BATCH_LIMIT;
    if (overLimit && !msg.overrideLimit) {
      videoIds = videoIds.slice(0, BATCH_LIMIT);
    }

    const targetTabId = msg.tabId || sender.tab?.id;
    // Process asynchronously
    processBatchExtraction(videoIds, targetTabId, msg.autoDownload)
      .then((results) => {
        // Store results for popup access
        chrome.storage.local.set({ batchResults: results });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          action: 'batch-error',
          error: String(err),
        }).catch(() => {});
      });

    sendResponse({ started: true, count: videoIds.length, overLimit });
    return true; // async response
  }

  if (msg.action === 'batch-pause') {
    if (batchControlState.isRunning) {
      batchControlState.isPaused = true;
      sendResponse({ success: true, isPaused: true, currentIndex: batchControlState.currentIndex });
    } else {
      sendResponse({ success: false, error: 'not-running' });
    }
    return true;
  }

  if (msg.action === 'batch-resume') {
    if (batchControlState.isRunning && batchControlState.isPaused) {
      batchControlState.isPaused = false;
      if (typeof batchControlState.pauseResolver === 'function') {
        const resolve = batchControlState.pauseResolver;
        batchControlState.pauseResolver = null;
        resolve();
      }
      chrome.runtime.sendMessage({
        action: 'batch-resumed',
        current: batchControlState.currentIndex + 1,
        total: batchControlState.total,
        statusText: `Resuming extraction at video ${batchControlState.currentIndex + 1} of ${batchControlState.total}...`,
      }).catch(() => {});
      sendResponse({ success: true, isResumed: true });
    } else {
      sendResponse({ success: false, error: 'not-paused' });
    }
    return true;
  }

  if (msg.action === 'batch-stop' || msg.action === 'batch-cancel') {
    if (batchControlState.isRunning) {
      batchControlState.isStopped = true;
      batchControlState.isPaused = false;
      if (typeof batchControlState.pauseResolver === 'function') {
        const resolve = batchControlState.pauseResolver;
        batchControlState.pauseResolver = null;
        resolve();
      }
      sendResponse({ success: true, isStopped: true, results: batchControlState.results });
    } else {
      sendResponse({ success: false, error: 'not-running' });
    }
    return true;
  }

  if (msg.action === 'get-batch-status') {
    sendResponse({
      isRunning: batchControlState.isRunning,
      isPaused: batchControlState.isPaused,
      isStopped: batchControlState.isStopped,
      currentIndex: batchControlState.currentIndex,
      total: batchControlState.total,
      resultsCount: batchControlState.results.length,
    });
    return true;
  }

  if (msg.action === 'fetch-single-transcript') {
    fetchTranscriptForVideo(msg.videoId, msg.trackIndex)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // async response
  }

  if (msg.action === 'quick-extract-and-copy') {
    const targetTab = sender.tab || null;
    const requestedLang = msg.requestedLang || msg.lang || null;
    const explicitVideoId = msg.videoId || null;

    if (!targetTab) {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab) {
          sendResponse({ success: false, error: 'no-tab' });
          return;
        }
        copyTranscriptFromTab(tab, requestedLang, explicitVideoId)
          .then((res) => sendResponse(res || { success: false, error: 'no-transcript' }))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
      });
    } else {
      // Re-fetch tab to get the latest URL in case of SPA transitions without page reload
      chrome.tabs.get(targetTab.id)
        .then((freshTab) => {
          copyTranscriptFromTab(freshTab || targetTab, requestedLang, explicitVideoId)
            .then((res) => sendResponse(res || { success: false, error: 'no-transcript' }))
            .catch((err) => sendResponse({ success: false, error: String(err) }));
        })
        .catch(() => {
          copyTranscriptFromTab(targetTab, requestedLang, explicitVideoId)
            .then((res) => sendResponse(res || { success: false, error: 'no-transcript' }))
            .catch((err) => sendResponse({ success: false, error: String(err) }));
        });
    }
    return true; // async response
  }
});
