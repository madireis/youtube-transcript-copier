/**
 * YouTube Transcript Copier — Batch Overlay Injector
 *
 * Injects selection checkboxes directly onto YouTube video cards
 * and a floating toolbar at the top of the page for batch operations.
 *
 * Communicates with popup/background via chrome.runtime messages.
 */
(() => {
  try {
    // Prevent double-injection
    if (document.querySelector('#ytc-batch-toolbar')) {
      return { success: true, alreadyInjected: true };
    }

    // ---- Inject CSS ----
    const style = document.createElement('style');
    style.id = 'ytc-batch-styles';
    style.textContent = `
      /* Floating Toolbar */
      #ytc-batch-toolbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 20px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-bottom: 2px solid #ff4e50;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #e4e4e8;
        animation: ytcSlideDown 300ms ease;
      }
      @keyframes ytcSlideDown {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      #ytc-batch-toolbar .ytc-toolbar-left {
        display: flex; align-items: center; gap: 12px;
      }
      #ytc-batch-toolbar .ytc-toolbar-logo {
        display: flex; align-items: center; gap: 6px;
        font-weight: 700; font-size: 13px;
        background: linear-gradient(135deg, #ff4e50, #ff8a5c);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      #ytc-batch-toolbar .ytc-toolbar-count {
        font-size: 12px; color: #8a8a96; font-weight: 500;
      }
      #ytc-batch-toolbar .ytc-toolbar-count strong {
        color: #ff4e50; font-weight: 700;
      }
      #ytc-batch-toolbar .ytc-toolbar-right {
        display: flex; align-items: center; gap: 8px;
      }
      #ytc-batch-toolbar button {
        padding: 7px 14px; border-radius: 7px;
        font-family: inherit; font-size: 12px; font-weight: 600;
        cursor: pointer; border: none;
        transition: all 180ms ease;
      }
      #ytc-batch-toolbar .ytc-btn-select-all {
        background: #2a2a3e; color: #e4e4e8; border: 1px solid #3a3a4e;
      }
      #ytc-batch-toolbar .ytc-btn-select-all:hover {
        background: #3a3a4e; border-color: #ff4e50;
      }
      #ytc-batch-toolbar .ytc-btn-deselect {
        background: #2a2a3e; color: #8a8a96; border: 1px solid #3a3a4e;
      }
      #ytc-batch-toolbar .ytc-btn-deselect:hover {
        background: #3a3a4e; border-color: #ef4444; color: #ef4444;
      }
      #ytc-batch-toolbar .ytc-btn-extract {
        background: linear-gradient(135deg, #ff4e50, #ff6b6b); color: white;
        box-shadow: 0 2px 12px rgba(255, 78, 80, 0.25);
      }
      #ytc-batch-toolbar .ytc-btn-extract:hover {
        transform: translateY(-1px); filter: brightness(1.1);
        box-shadow: 0 4px 20px rgba(255, 78, 80, 0.35);
      }
      #ytc-batch-toolbar .ytc-btn-extract:disabled {
        opacity: 0.5; cursor: not-allowed; transform: none !important;
      }
      #ytc-batch-toolbar .ytc-btn-close {
        background: transparent; color: #8a8a96; font-size: 18px;
        padding: 4px 8px; border: none;
      }
      #ytc-batch-toolbar .ytc-btn-close:hover { color: #ef4444; }

      /* Push page content down */
      body.ytc-batch-active {
        margin-top: 54px !important;
      }

      /* Video Card Checkbox Overlay */
      .ytc-card-checkbox {
        position: absolute !important;
        top: 8px !important;
        left: 8px !important;
        z-index: 2147483647 !important; /* Max z-index to stay on top of YouTube hover preview */
        width: 26px !important;
        height: 26px !important;
        border-radius: 6px !important;
        border: 2px solid rgba(255, 78, 80, 0.9) !important;
        background: rgba(15, 15, 17, 0.85) !important;
        backdrop-filter: blur(4px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        transition: all 180ms ease !important;
        animation: ytcFadeIn 200ms ease;
      }
      @keyframes ytcFadeIn {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }
      .ytc-card-checkbox:hover {
        border-color: #ff4e50 !important;
        background: rgba(255, 78, 80, 0.3) !important;
        transform: scale(1.1) !important;
      }
      .ytc-card-checkbox.selected {
        background: #ff4e50 !important;
        border-color: #ff4e50 !important;
      }
      .ytc-card-checkbox svg {
        width: 14px;
        height: 14px;
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .ytc-card-checkbox.selected svg {
        opacity: 1 !important;
      }

      /* Playlist item checkboxes (more compact for panel items) */
      ytd-playlist-panel-video-renderer .ytc-card-checkbox {
        top: 4px !important;
        left: 4px !important;
        width: 20px !important;
        height: 20px !important;
        border-radius: 4px !important;
      }
      ytd-playlist-panel-video-renderer .ytc-card-checkbox svg {
        width: 11px !important;
        height: 11px !important;
      }

      /* Group Select Buttons */
      #ytc-batch-toolbar .ytc-btn-group-select {
        background: #2a2a3e; color: #e4e4e8; border: 1px solid #3a3a4e;
        display: inline-flex; align-items: center; gap: 5px;
      }
      #ytc-batch-toolbar .ytc-btn-group-select:hover {
        background: #3a3a4e; border-color: #ff4e50; color: #fff;
      }

      /* Make video card containers positioned for overlay */
      yt-lockup-view-model,
      .ytLockupViewModelHost,
      ytd-rich-item-renderer,
      ytd-grid-video-renderer,
      ytd-video-renderer,
      ytd-playlist-video-renderer,
      ytd-playlist-panel-video-renderer,
      ytd-compact-video-renderer,
      ytd-reel-item-renderer {
        position: relative !important;
      }
    `;
    document.head.appendChild(style);

    // ---- State ----
    const selectedVideoIds = new Set();

    // ---- Helper: Extract video ID from href ----
    function extractVideoId(href) {
      if (!href) return null;
      let m = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      m = href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      return null;
    }

    // ---- Inject Checkboxes on Video Cards ----
    function injectCheckboxes() {
      const selectors = [
        'yt-lockup-view-model',
        'ytd-rich-item-renderer',
        'ytd-grid-video-renderer',
        'ytd-video-renderer',
        'ytd-playlist-video-renderer',
        'ytd-playlist-panel-video-renderer',
        'ytd-compact-video-renderer',
        'ytd-reel-item-renderer',
      ];

      const cards = document.querySelectorAll(selectors.join(', '));

      cards.forEach((card) => {
        if (card.querySelector('.ytc-card-checkbox')) return; // already injected

        // Exclude ads and sponsored slots
        if (typeof card.closest === 'function') {
          if (card.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ad-badge-view-model, [class*="badge-style-type-ad"]')) {
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

        let href = linkEl ? ((typeof linkEl.href === 'string' ? linkEl.href : '') || (typeof linkEl.getAttribute === 'function' ? linkEl.getAttribute('href') : '') || '') : '';
        let videoId = extractVideoId(href);

        // Fallback: check content-id-XXXX in class names
        if (!videoId) {
          const hostEl = (card.classList && card.classList.contains('ytLockupViewModelHost'))
            ? card
            : (typeof card.querySelector === 'function' ? card.querySelector('.ytLockupViewModelHost') : null);
          const classStr = (hostEl && hostEl.className) || card.className || '';
          const match = (typeof classStr === 'string') ? classStr.match(/content-id-([a-zA-Z0-9_-]{11})/) : null;
          if (match) videoId = match[1];
        }

        if (!videoId) return;

        // Create checkbox element
        const isPlaylist = Boolean(card.closest && card.closest('ytd-playlist-panel-renderer, #playlist, ytd-playlist-video-list-renderer'));
        const checkbox = document.createElement('div');
        checkbox.className = 'ytc-card-checkbox';
        checkbox.dataset.videoId = videoId;
        checkbox.dataset.group = isPlaylist ? 'playlist' : 'other';
        checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>';

        const handleToggle = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          }

          if (selectedVideoIds.has(videoId)) {
            selectedVideoIds.delete(videoId);
            checkbox.classList.remove('selected');
          } else {
            selectedVideoIds.add(videoId);
            checkbox.classList.add('selected');
          }

          updateToolbarCount();
          notifyPopupSelectionChanged();
        };

        // Prevent YouTube video navigation & hover preview stealing (useCapture = true)
        ['click', 'mousedown', 'mouseup', 'pointerdown'].forEach((evtType) => {
          checkbox.addEventListener(evtType, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (evtType === 'click') {
              handleToggle(e);
            }
          }, true);
        });

        // Find the thumbnail container for proper positioning
        const thumbnailContainer =
          card.querySelector('yt-thumbnail-view-model') ||
          card.querySelector('.ytLockupViewModelContentImage') ||
          card.querySelector('ytd-thumbnail') ||
          card.querySelector('#thumbnail-container') ||
          card.querySelector('#thumbnail') ||
          card;

        // Ensure the container is positioned
        if (thumbnailContainer !== card) {
          thumbnailContainer.style.position = 'relative';
        }

        thumbnailContainer.appendChild(checkbox);
      });
    }

    /** Notify the popup/extension about the current overlay selection state */
    function notifyPopupSelectionChanged() {
      chrome.runtime.sendMessage({
        action: 'overlay-selection-changed',
        videoIds: Array.from(selectedVideoIds),
      }).catch(() => {});
    }

    /** Apply a selection set from the popup to the overlay checkboxes */
    function applySelectionFromPopup(videoIds) {
      const newSet = new Set(videoIds);
      selectedVideoIds.clear();
      newSet.forEach((id) => selectedVideoIds.add(id));

      document.querySelectorAll('.ytc-card-checkbox').forEach((cb) => {
        const vid = cb.dataset.videoId;
        if (newSet.has(vid)) {
          cb.classList.add('selected');
        } else {
          cb.classList.remove('selected');
        }
      });

      updateToolbarCount();
    }

    // ---- Toolbar ----
    function createToolbar() {
      const toolbar = document.createElement('div');
      toolbar.id = 'ytc-batch-toolbar';

      const hasPlaylist = Boolean(
        document.querySelector('ytd-playlist-panel-renderer#playlist, #playlist, ytd-playlist-panel-renderer, ytd-playlist-video-list-renderer') ||
        window.location.href.includes('list=')
      );

      const rightButtonsHtml = hasPlaylist ? `
        <button class="ytc-btn-group-select" id="ytc-select-playlist" title="Select all videos in playlist">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6M18.5 18a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12 12H3M16 6H3M12 18H3"/></svg>
          Select Playlist
        </button>
        <button class="ytc-btn-group-select" id="ytc-select-other" title="Select recommended and other videos">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="10 8 16 11 10 14 10 8"/></svg>
          Select Other
        </button>
        <button class="ytc-btn-deselect" id="ytc-deselect-all">Deselect All</button>
        <button class="ytc-btn-extract" id="ytc-extract-btn" disabled>Extract Transcripts (0)</button>
        <button class="ytc-btn-close" id="ytc-close-toolbar" title="Close batch mode">&times;</button>
      ` : `
        <button class="ytc-btn-select-all" id="ytc-select-all">Select All</button>
        <button class="ytc-btn-deselect" id="ytc-deselect-all">Deselect All</button>
        <button class="ytc-btn-extract" id="ytc-extract-btn" disabled>Extract Transcripts (0)</button>
        <button class="ytc-btn-close" id="ytc-close-toolbar" title="Close batch mode">&times;</button>
      `;

      toolbar.innerHTML = `
        <div class="ytc-toolbar-left">
          <div class="ytc-toolbar-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="3" width="20" height="15" rx="4" fill="#ff4e50" stroke="#ff4e50" stroke-width="1.2"/>
              <polygon points="10,7.5 16,10.5 10,13.5" fill="#ffffff"/>
              <path d="M5 21h14M8 18h8" stroke="#ff8a5c" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            Batch Transcript
          </div>
          <span class="ytc-toolbar-count">
            <strong id="ytc-selected-count">0</strong> videos selected
          </span>
        </div>
        <div class="ytc-toolbar-right">
          ${rightButtonsHtml}
        </div>
      `;

      document.body.prepend(toolbar);
      document.body.classList.add('ytc-batch-active');

      // Event Handlers
      document.getElementById('ytc-select-all')?.addEventListener('click', () => {
        document.querySelectorAll('.ytc-card-checkbox').forEach((cb) => {
          const vid = cb.dataset.videoId;
          if (vid && !selectedVideoIds.has(vid)) {
            selectedVideoIds.add(vid);
            cb.classList.add('selected');
          }
        });
        updateToolbarCount();
        notifyPopupSelectionChanged();
      });

      document.getElementById('ytc-select-playlist')?.addEventListener('click', () => {
        document.querySelectorAll('.ytc-card-checkbox[data-group="playlist"]').forEach((cb) => {
          const vid = cb.dataset.videoId;
          if (vid && !selectedVideoIds.has(vid)) {
            selectedVideoIds.add(vid);
            cb.classList.add('selected');
          }
        });
        updateToolbarCount();
        notifyPopupSelectionChanged();
      });

      document.getElementById('ytc-select-other')?.addEventListener('click', () => {
        document.querySelectorAll('.ytc-card-checkbox[data-group="other"]').forEach((cb) => {
          const vid = cb.dataset.videoId;
          if (vid && !selectedVideoIds.has(vid)) {
            selectedVideoIds.add(vid);
            cb.classList.add('selected');
          }
        });
        updateToolbarCount();
        notifyPopupSelectionChanged();
      });

      document.getElementById('ytc-deselect-all').addEventListener('click', () => {
        selectedVideoIds.clear();
        document.querySelectorAll('.ytc-card-checkbox.selected').forEach((cb) => {
          cb.classList.remove('selected');
        });
        updateToolbarCount();
        notifyPopupSelectionChanged();
      });

      document.getElementById('ytc-extract-btn').addEventListener('click', () => {
        // Send selected video IDs to the extension background
        chrome.runtime.sendMessage({
          action: 'batch-extract-start',
          videoIds: Array.from(selectedVideoIds),
          autoDownload: true,
        });
      });

      document.getElementById('ytc-close-toolbar').addEventListener('click', () => {
        removeOverlay();
      });
    }

    function updateToolbarCount() {
      const count = selectedVideoIds.size;
      const countEl = document.getElementById('ytc-selected-count');
      const extractBtn = document.getElementById('ytc-extract-btn');
      if (countEl) countEl.textContent = count;
      if (extractBtn) {
        extractBtn.textContent = `Extract Transcripts (${count})`;
        extractBtn.disabled = count === 0;
      }
    }

    function removeOverlay() {
      const toolbar = document.getElementById('ytc-batch-toolbar');
      if (toolbar) toolbar.remove();
      const style = document.getElementById('ytc-batch-styles');
      if (style) style.remove();
      document.querySelectorAll('.ytc-card-checkbox').forEach((cb) => cb.remove());
      document.body.classList.remove('ytc-batch-active');
      selectedVideoIds.clear();
    }

    // ---- Initialize ----
    createToolbar();
    injectCheckboxes();

    // Watch for dynamically loaded video cards (infinite scroll)
    const observer = new MutationObserver(() => {
      injectCheckboxes();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'get-selected-videos') {
        sendResponse({ videoIds: Array.from(selectedVideoIds) });
      }
      if (msg.action === 'sync-selection-to-overlay') {
        // Popup is telling us which videos are selected — update overlay
        applySelectionFromPopup(msg.videoIds || []);
        sendResponse({ success: true });
      }
      if (msg.action === 'close-batch-overlay') {
        removeOverlay();
        observer.disconnect();
        sendResponse({ success: true });
      }
    });

    return { success: true, injected: true };
  } catch (err) {
    return {
      success: false,
      error: 'overlay-inject-error',
      detail: String(err && err.message ? err.message : err),
    };
  }
})();
