/**
 * YouTube Transcript Copier — Batch Content Script
 *
 * Injected on-demand into a YouTube tab to:
 * 1. Detect page type and active playlist panel (if present).
 * 2. Partition videos into two distinct groups:
 *    - Playlist videos (from ytd-playlist-panel-renderer or playlist page)
 *    - Other/Bottom videos (recommendations, related, bottom-of-video suggestions)
 * 3. Extract comprehensive video metadata (title, duration, thumbnail, url).
 *
 * Returns: {
 *   success: true,
 *   pageType: string,
 *   hasPlaylist: boolean,
 *   playlistInfo: { id, title, countText, totalCount } | null,
 *   playlistVideos: Array,
 *   otherVideos: Array,
 *   videoCount: number,
 *   videos: Array
 * }
 */
(() => {
  try {
    const url = window.location.href;

    // ---- Page Type Detection ----
    function detectPageType() {
      if (/youtube\.com\/playlist\?list=/.test(url)) return 'playlist';
      if (/youtube\.com\/(results|search)/.test(url)) return 'search';
      if (/youtube\.com\/(@[^/]+|channel\/|c\/|user\/)/.test(url)) return 'channel';
      if (/youtube\.com\/shorts\//.test(url)) return 'shorts-watch';
      if (/youtube\.com\/watch/.test(url)) return 'watch';
      if (/youtube\.com\/@[^/]+\/shorts/.test(url)) return 'shorts-grid';
      if (/youtube\.com/.test(url)) {
        const tabContent = document.querySelector('ytd-rich-grid-renderer, ytd-section-list-renderer');
        return tabContent ? 'channel' : 'other';
      }
      return 'other';
    }

    // ---- Video ID & Metadata Helpers ----
    function extractVideoId(href) {
      if (!href) return null;
      let m = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      m = href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      return null;
    }

    function extractPlaylistId(href) {
      if (!href) return null;
      const m = href.match(/[?&]list=([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    }

    function getText(el) {
      return (el && typeof el.textContent === 'string') ? el.textContent.trim() : '';
    }

    function getThumbnail(container, videoId) {
      if (container && typeof container.querySelector === 'function') {
        const img = container.querySelector(
          'yt-thumbnail-view-model img, ' +
          '.ytThumbnailViewModelImage img, ' +
          'img.ytCoreImageHost, ' +
          'img#img, img.yt-core-image, ' +
          'ytd-thumbnail img, yt-image img'
        );
        if (img) {
          const src = (typeof img.src === 'string' ? img.src : '') ||
            (typeof img.getAttribute === 'function' ? (img.getAttribute('src') || img.getAttribute('data-thumb')) : '') || '';
          if (src && !src.startsWith('data:image/svg')) return src;
        }
      }
      return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
    }

    function getDuration(container) {
      if (!container || typeof container.querySelector !== 'function') return '';
      const badge = container.querySelector(
        '.thumbnail-overlay-badge-shape badge-shape .ytBadgeShapeText, ' +
        'yt-thumbnail-bottom-overlay-view-model .ytBadgeShapeText, ' +
        'badge-shape .ytBadgeShapeText, ' +
        '.ytBadgeShapeText, ' +
        'span#text.ytd-thumbnail-overlay-time-status-renderer, ' +
        'ytd-thumbnail-overlay-time-status-renderer span, ' +
        'badge-shape .badge-shape-wiz__text, ' +
        '#time-status #text, ' +
        'div.ytd-thumbnail-overlay-time-status-renderer'
      );
      return getText(badge);
    }

    // ---- Playlist Detection & Scanning ----
    function scanPlaylist() {
      // Look for watch-page playlist panel first
      const panel = document.querySelector(
        'ytd-playlist-panel-renderer#playlist, ' +
        'ytd-playlist-panel-renderer, ' +
        '#playlist.ytd-watch-flexy, ' +
        '#playlist'
      );

      // Or full playlist browse page
      const playlistPage = document.querySelector(
        'ytd-playlist-video-list-renderer, ' +
        'ytd-browse[page-subtype="playlist"]'
      );

      const listId = extractPlaylistId(url);
      if (!panel && !playlistPage && !listId) {
        return { hasPlaylist: false, playlistInfo: null, playlistVideos: [] };
      }

      let playlistTitle = '';
      let playlistCountText = '';

      if (panel) {
        const titleEl = panel.querySelector(
          '#header-description h3, ' +
          'h3 yt-attributed-string.title a, ' +
          'h3 yt-attributed-string.title, ' +
          '.header .title a, ' +
          'h3 .title a, ' +
          'h3 .title, ' +
          'yt-formatted-string.title a, ' +
          'yt-formatted-string.title, ' +
          '#header-contents h3, ' +
          'h3#title'
        );
        playlistTitle = getText(titleEl);

        const countEl = panel.querySelector(
          '.index-message-wrapper yt-formatted-string.index-message, ' +
          '.index-message-wrapper, ' +
          '.index-message, ' +
          '#index-message'
        );
        playlistCountText = getText(countEl);
      } else if (playlistPage) {
        const pageTitleEl = document.querySelector(
          'ytd-playlist-header-renderer h1, ' +
          '#header-description h1, ' +
          'yt-dynamic-sizing-formatted-string#text, ' +
          'h1#title'
        );
        playlistTitle = getText(pageTitleEl);

        const statsEl = document.querySelector('ytd-playlist-header-renderer .metadata-stats, .byline-item');
        playlistCountText = getText(statsEl);
      }

      if (!playlistTitle) {
        playlistTitle = document.title ? document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() : 'Playlist';
      }

      // Collect playlist video card elements
      const panelItems = panel
        ? panel.querySelectorAll('ytd-playlist-panel-video-renderer')
        : [];
      const pageItems = (!panelItems || panelItems.length === 0)
        ? document.querySelectorAll('ytd-playlist-video-renderer')
        : [];

      const targetItems = (panelItems && panelItems.length > 0) ? panelItems : pageItems;
      const playlistVideos = [];
      const seenPlaylistIds = new Set();

      targetItems.forEach((item, idx) => {
        const linkEl =
          item.querySelector('a#wc-endpoint') ||
          item.querySelector('a#video-title-link') ||
          item.querySelector('a#thumbnail') ||
          item.querySelector('a[href*="/watch"]');

        if (!linkEl) return;

        const href = (typeof linkEl.href === 'string' ? linkEl.href : '') ||
          (typeof linkEl.getAttribute === 'function' ? linkEl.getAttribute('href') : '') || '';
        const videoId = extractVideoId(href);
        if (!videoId || seenPlaylistIds.has(videoId)) return;
        seenPlaylistIds.add(videoId);

        const titleEl =
          item.querySelector('#video-title') ||
          item.querySelector('span#video-title') ||
          item.querySelector('yt-formatted-string#video-title') ||
          item.querySelector('.title') ||
          item.querySelector('h3 a');

        let title = getText(titleEl) || (linkEl.getAttribute && linkEl.getAttribute('title')) || '';
        if (!title) title = `Playlist Video ${idx + 1}`;

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}${listId ? `&list=${listId}` : ''}`;
        const thumbnail = getThumbnail(item, videoId);
        const duration = getDuration(item);

        playlistVideos.push({
          videoId,
          title,
          url: videoUrl,
          thumbnail,
          duration,
          isShort: false,
          group: 'playlist',
          source: 'playlist',
          playlistIndex: idx + 1,
        });
      });

      const hasPlaylist = (panel !== null || playlistPage !== null || listId !== null) && playlistVideos.length > 0;

      return {
        hasPlaylist,
        playlistInfo: hasPlaylist ? {
          id: listId || '',
          title: playlistTitle,
          countText: playlistCountText,
          totalCount: playlistVideos.length,
        } : null,
        playlistVideos,
      };
    }

    // ---- Scan Other / Bottom Videos ----
    function scanOtherVideos(playlistVideoIds) {
      const otherVideos = [];
      const seen = new Set(playlistVideoIds);

      // If user is on a watch or shorts page, check if current primary video should be included
      const currentVideoId = extractVideoId(url);
      if (currentVideoId && !seen.has(currentVideoId)) {
        seen.add(currentVideoId);
        let currentTitle = document.title ? document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() : '';
        const titleEl = document.querySelector('h1.ytd-watch-metadata, #title h1 yt-formatted-string, h1.title');
        if (titleEl && typeof titleEl.textContent === 'string' && titleEl.textContent.trim()) {
          currentTitle = titleEl.textContent.trim();
        }
        const isShort = url.includes('/shorts/');
        const currentUrl = isShort
          ? `https://www.youtube.com/shorts/${currentVideoId}`
          : `https://www.youtube.com/watch?v=${currentVideoId}`;
        const thumbUrl = `https://i.ytimg.com/vi/${currentVideoId}/hqdefault.jpg`;

        otherVideos.push({
          videoId: currentVideoId,
          title: currentTitle || `Current Video`,
          url: currentUrl,
          thumbnail: thumbUrl,
          duration: '',
          isShort,
          group: 'other',
          source: 'current',
        });
      }

      // Selectors for recommendations, sidebar, and bottom videos
      const selectors = [
        'yt-lockup-view-model',
        'ytd-compact-video-renderer',
        'ytd-rich-item-renderer',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-reel-item-renderer',
      ];

      const cards = document.querySelectorAll(selectors.join(', '));

      cards.forEach((card) => {
        // Exclude ads and sponsored slots
        if (typeof card.closest === 'function') {
          if (card.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ad-badge-view-model, [class*="badge-style-type-ad"]')) {
            return;
          }
          // Exclude cards that are inside a playlist panel
          if (card.closest('ytd-playlist-panel-renderer, #playlist')) {
            return;
          }
        }

        if (typeof card.querySelector === 'function') {
          if (card.querySelector('a[href*="googleadservices.com"], ad-badge-view-model, ytd-in-feed-ad-layout-renderer')) {
            return;
          }
        }

        const linkEl =
          card.querySelector('a#video-title-link') ||
          card.querySelector('a#video-title') ||
          card.querySelector('a.ytLockupViewModelTitle') ||
          card.querySelector('a.ytLockupViewModelContentImage') ||
          card.querySelector('a#thumbnail') ||
          card.querySelector('a.yt-simple-endpoint[href*="/watch"]') ||
          card.querySelector('a.yt-simple-endpoint[href*="/shorts/"]') ||
          card.querySelector('a[href*="/watch"]') ||
          card.querySelector('a[href*="/shorts/"]');

        let videoId = null;
        let href = '';
        if (linkEl) {
          href = (typeof linkEl.href === 'string' ? linkEl.href : '') ||
            (typeof linkEl.getAttribute === 'function' ? linkEl.getAttribute('href') : '') || '';
          videoId = extractVideoId(href);
        }

        // Fallback: check content-id-XXXX in class names
        if (!videoId) {
          const hostEl = (card.classList && card.classList.contains('ytLockupViewModelHost'))
            ? card
            : (typeof card.querySelector === 'function' ? card.querySelector('.ytLockupViewModelHost') : null);
          const classStr = (hostEl && hostEl.className) || card.className || '';
          const match = (typeof classStr === 'string') ? classStr.match(/content-id-([a-zA-Z0-9_-]{11})/) : null;
          if (match) videoId = match[1];
        }

        if (!videoId || seen.has(videoId)) return;
        seen.add(videoId);

        const titleEl =
          card.querySelector('h3.ytLockupMetadataViewModelHeadingReset') ||
          card.querySelector('a.ytLockupViewModelTitle') ||
          card.querySelector('#video-title') ||
          card.querySelector('yt-formatted-string#video-title') ||
          card.querySelector('h3 a') ||
          card.querySelector('.title');

        let title = '';
        if (titleEl) {
          title = (typeof titleEl.getAttribute === 'function' ? titleEl.getAttribute('title') : '') ||
            getText(titleEl);
        }
        if (!title && linkEl && typeof linkEl.getAttribute === 'function') {
          title = linkEl.getAttribute('title') || '';
        }
        if (!title) title = `Video ${videoId}`;

        const isShort = href.includes('/shorts/') ||
          (card.tagName && card.tagName.toLowerCase() === 'ytd-reel-item-renderer');

        const videoUrl = isShort
          ? `https://www.youtube.com/shorts/${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`;

        const thumbnail = getThumbnail(card, videoId);
        const duration = getDuration(card);

        otherVideos.push({
          videoId,
          title,
          url: videoUrl,
          thumbnail,
          duration,
          isShort,
          group: 'other',
          source: 'other',
        });
      });

      return otherVideos;
    }

    // ---- Execute Detection & Partitioning ----
    const pageType = detectPageType();
    const playlistScan = scanPlaylist();
    const playlistVideos = playlistScan.playlistVideos || [];
    const playlistIds = new Set(playlistVideos.map((v) => v.videoId));

    const otherVideos = scanOtherVideos(playlistIds);
    const allVideos = [...playlistVideos, ...otherVideos];

    return {
      success: true,
      pageType,
      pageUrl: url,
      pageTitle: document.title,
      hasPlaylist: playlistScan.hasPlaylist,
      playlistInfo: playlistScan.playlistInfo,
      playlistVideos,
      otherVideos,
      videoCount: allVideos.length,
      videos: allVideos,
    };
  } catch (err) {
    return {
      success: false,
      error: 'batch-scan-error',
      detail: String(err && err.message ? err.message : err),
    };
  }
})();
