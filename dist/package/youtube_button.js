/**
 * YouTube Transcript Copier — Native 1-Click Action Bar Button
 *
 * Injects a native-looking "Transcript" button directly into YouTube's
 * primary action bar (#top-level-buttons-computed) next to Like/Dislike, Share, etc.
 *
 * Clicking this button instantly extracts, formats, and copies the video's transcript
 * to the clipboard in a single click with instant visual feedback and a toast alert.
 */
(() => {
  'use strict';

  const BUTTON_ID = 'ytc-transcript-quick-button';
  const STYLE_ID = 'ytc-quick-button-styles';
  const TOAST_ID = 'ytc-transcript-toast';

  let isExtracting = false;
  let toastTimeout = null;

  // ---- 1. Native Styles Injection ----
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Container alignment in YouTube top-level buttons */
      .ytc-transcript-btn-wrapper {
        display: inline-flex !important;
        align-items: center !important;
        margin-left: 6px !important;
        flex-shrink: 0 !important;
      }

      /* Native YouTube Tonal Button Look & Feel */
      .ytc-quick-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        height: 36px !important;
        padding: 0 16px 0 12px !important;
        border-radius: 18px !important;
        border: none !important;
        cursor: pointer !important;
        font-family: "Roboto", "YouTube Sans", Arial, sans-serif !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        line-height: 36px !important;
        letter-spacing: 0.1px !important;
        transition: background-color 0.2s cubic-bezier(0.05, 0, 0, 1), transform 0.1s ease !important;
        user-select: none !important;
        background-color: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1)) !important;
        color: var(--yt-spec-text-primary, #f1f1f1) !important;
      }

      .ytc-quick-btn:hover {
        background-color: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.2)) !important;
      }

      .ytc-quick-btn:active {
        transform: scale(0.96) !important;
        background-color: rgba(255, 255, 255, 0.25) !important;
      }

      /* State: Loading / Extracting */
      .ytc-quick-btn.ytc-loading {
        opacity: 0.85 !important;
        cursor: wait !important;
      }
      .ytc-quick-btn.ytc-loading .ytc-btn-icon svg {
        animation: ytcBtnSpin 0.9s linear infinite !important;
      }
      @keyframes ytcBtnSpin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* State: Success Copied */
      .ytc-quick-btn.ytc-success {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.3)) !important;
        color: #34d399 !important;
        border: 1px solid rgba(52, 211, 153, 0.4) !important;
      }
      .ytc-quick-btn.ytc-success svg {
        fill: #34d399 !important;
      }

      /* State: Error */
      .ytc-quick-btn.ytc-error {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(220, 38, 38, 0.28)) !important;
        color: #f87171 !important;
        border: 1px solid rgba(248, 113, 113, 0.35) !important;
      }
      .ytc-quick-btn.ytc-error svg {
        fill: #f87171 !important;
      }

      /* Icon & text layout */
      .ytc-btn-icon {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin-right: 6px !important;
        width: 20px !important;
        height: 20px !important;
        color: inherit !important;
      }
      .ytc-btn-icon svg {
        width: 20px !important;
        height: 20px !important;
        fill: currentColor !important;
      }
      .ytc-btn-text {
        font-size: 14px !important;
        font-weight: 500 !important;
        white-space: nowrap !important;
        color: inherit !important;
      }

      /* Floating Toast Notification */
      .ytc-toast {
        position: fixed !important;
        bottom: 40px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(24px) !important;
        background: rgba(18, 18, 22, 0.94) !important;
        color: #ffffff !important;
        border: 1px solid rgba(255, 78, 80, 0.4) !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        padding: 10px 22px !important;
        border-radius: 24px !important;
        font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        z-index: 9999999 !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        opacity: 0 !important;
        transition: opacity 220ms ease, transform 220ms cubic-bezier(0.16, 1, 0.3, 1) !important;
        pointer-events: none !important;
      }
      .ytc-toast.ytc-toast-visible {
        transform: translateX(-50%) translateY(0) !important;
        opacity: 1 !important;
      }
      .ytc-toast-badge {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 20px !important;
        height: 20px !important;
        border-radius: 50% !important;
        background: #10b981 !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: bold !important;
        flex-shrink: 0 !important;
      }
      .ytc-toast-badge.error {
        background: #ef4444 !important;
      }

      /* YouTube Shorts Action Bar Integration */
      .ytc-shorts-btn-container {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        margin-bottom: 16px !important;
        user-select: none !important;
        flex-shrink: 0 !important;
      }

      .ytc-shorts-quick-btn {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 48px !important;
        height: 48px !important;
        min-width: 48px !important;
        min-height: 48px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        border: none !important;
        cursor: pointer !important;
        background-color: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.15)) !important;
        color: var(--yt-spec-text-primary, #ffffff) !important;
        transition: background-color 0.2s cubic-bezier(0.05, 0, 0, 1), transform 0.15s ease !important;
        box-sizing: border-box !important;
        outline: none !important;
      }

      .ytc-shorts-quick-btn:hover {
        background-color: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.28)) !important;
        transform: scale(1.06) !important;
      }

      .ytc-shorts-quick-btn:active {
        transform: scale(0.94) !important;
        background-color: rgba(255, 255, 255, 0.35) !important;
      }

      .ytc-shorts-quick-btn.ytc-loading {
        cursor: wait !important;
        opacity: 0.85 !important;
      }

      .ytc-shorts-quick-btn.ytc-loading .ytc-btn-icon svg {
        animation: ytcBtnSpin 0.9s linear infinite !important;
      }

      .ytc-shorts-quick-btn.ytc-success {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.45)) !important;
        color: #34d399 !important;
        border: 1px solid rgba(52, 211, 153, 0.5) !important;
      }
      .ytc-shorts-quick-btn.ytc-success svg {
        fill: #34d399 !important;
      }

      .ytc-shorts-quick-btn.ytc-error {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.4)) !important;
        color: #f87171 !important;
        border: 1px solid rgba(248, 113, 113, 0.45) !important;
      }
      .ytc-shorts-quick-btn.ytc-error svg {
        fill: #f87171 !important;
      }

      .ytc-shorts-label-box {
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        margin-top: 6px !important;
        max-width: 90px !important;
        text-align: center !important;
      }

      .ytc-shorts-btn-label {
        font-family: "Roboto", "YouTube Sans", Arial, sans-serif !important;
        font-size: 12px !important;
        line-height: 16px !important;
        font-weight: 500 !important;
        color: var(--yt-spec-text-primary, #f1f1f1) !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8) !important;
        white-space: nowrap !important;
        letter-spacing: 0.1px !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ---- 2. Toast Notification Helper ----
  function showToast(message, isError = false) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.className = 'ytc-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = '';
    const badge = document.createElement('span');
    badge.className = badgeClass;
    badge.textContent = badgeIcon;
    const textSpan = document.createElement('span');
    textSpan.textContent = String(message || '');
    toast.appendChild(badge);
    toast.appendChild(textSpan);


    if (toastTimeout) clearTimeout(toastTimeout);

    // Force reflow
    void toast.offsetWidth;
    toast.classList.add('ytc-toast-visible');

    toastTimeout = setTimeout(() => {
      toast.classList.remove('ytc-toast-visible');
    }, 3200);
  }

  function incrementRatingUsageCount() {
    try {
      chrome.storage.local.get('ytc_rating_prompt_state', (res) => {
        const state = res?.ytc_rating_prompt_state || { usageCount: 0, dismissed: false, snoozedUntil: 0 };
        if (state.dismissed) return;
        state.usageCount = (state.usageCount || 0) + 1;
        chrome.storage.local.set({ ytc_rating_prompt_state: state });
      });
    } catch {}
  }

  // ---- 3. SVG Icons ----
  const TRANSCRIPT_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2zm-4 8H7v-2h6v2z"/>
    </svg>
  `;

  const SPINNER_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
      <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
    </svg>
  `;

  const CHECK_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
    </svg>
  `;

  const ERROR_ICON_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
  `;

  // ---- 4. Button State Manager ----
  function setButtonState(btn, state, text) {
    const iconEl = btn.querySelector('.ytc-btn-icon');
    const textEl = btn.querySelector('.ytc-btn-text');

    btn.classList.remove('ytc-loading', 'ytc-success', 'ytc-error');

    if (state === 'loading') {
      btn.classList.add('ytc-loading');
      if (iconEl) iconEl.innerHTML = SPINNER_ICON_SVG;
      if (textEl) textEl.textContent = text || 'Copying...';
    } else if (state === 'success') {
      btn.classList.add('ytc-success');
      if (iconEl) iconEl.innerHTML = CHECK_ICON_SVG;
      if (textEl) textEl.textContent = text || '✓ Copied!';
    } else if (state === 'error') {
      btn.classList.add('ytc-error');
      if (iconEl) iconEl.innerHTML = ERROR_ICON_SVG;
      if (textEl) textEl.textContent = text || 'Failed';
    } else {
      // Idle
      if (iconEl) iconEl.innerHTML = TRANSCRIPT_ICON_SVG;
      if (textEl) textEl.textContent = text || 'Copy Transcript';
    }
  }

  // ---- 5. Click Handler: 1-Click Extraction ----
  async function handleButtonClick(e, btn) {
    e.preventDefault();
    e.stopPropagation();

    if (isExtracting) return;
    isExtracting = true;

    setButtonState(btn, 'loading', 'Copying...');

    // Immediately open YouTube's transcript section in the page
    try {
      if (typeof window.__ytcOpenTranscriptSection === 'function') {
        window.__ytcOpenTranscriptSection().catch(() => {});
      } else {
        const directBtn = document.querySelector(
          'ytd-video-description-transcript-section-renderer #primary-button button, ' +
          'ytd-video-description-transcript-section-renderer button, ' +
          'ytd-structured-description-content-renderer ytd-video-description-transcript-section-renderer button, ' +
          'button[aria-label*="show transcript" i]'
        );
        if (directBtn) {
          directBtn.click();
        } else {
          const exp = document.querySelector('#expand.ytd-text-inline-expander, #description-inline-expander #expand, #description');
          if (exp) {
            exp.click();
            setTimeout(() => {
              const b = document.querySelector('ytd-video-description-transcript-section-renderer button, button[aria-label*="show transcript" i]');
              if (b) b.click();
            }, 300);
          }
        }
      }
    } catch {}

    try {
      chrome.runtime.sendMessage({ action: 'quick-extract-and-copy' }, (response) => {
        isExtracting = false;

        if (chrome.runtime.lastError || !response || !response.success) {
          const errReason = response?.error === 'no-transcript' ? 'No transcript' : 'Copy failed';
          setButtonState(btn, 'error', errReason);
          showToast(
            response?.error === 'no-transcript'
              ? 'No transcript found for this video'
              : 'Could not extract transcript (Try playing the video first)',
            true
          );
          setTimeout(() => setButtonState(btn, 'idle', 'Copy Transcript'), 2600);
          return;
        }

        // Direct clipboard write fallback in user-gesture context
        if (response.formatted) {
          navigator.clipboard.writeText(response.formatted).catch(() => {});
        }

        setButtonState(btn, 'success', '✓ Copied!');
        const lineCountStr = response.linesCount ? ` (${response.linesCount} lines)` : '';
        showToast(`Transcript copied to clipboard${lineCountStr}!`, false);
        incrementRatingUsageCount();

        setTimeout(() => setButtonState(btn, 'idle', 'Copy Transcript'), 2600);
      });
    } catch (err) {
      isExtracting = false;
      setButtonState(btn, 'error', 'Error');
      showToast('Extension communication error', true);
      setTimeout(() => setButtonState(btn, 'idle', 'Copy Transcript'), 2600);
    }
  }

  // ---- 6. Find Action Bar Container ----
  function findActionBarContainer() {
    const candidates = [
      // Primary YouTube computed top-level action bar
      'ytd-watch-metadata #top-level-buttons-computed',
      '#top-level-buttons-computed.top-level-buttons',
      '#top-level-buttons-computed',
      'ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed',
      '#actions-inner #top-level-buttons-computed',
      '#actions #top-level-buttons-computed',
      '#menu #top-level-buttons-computed',
      '#flexible-item-buttons',
    ];

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.isConnected && el.offsetParent !== null) {
        return el;
      }
    }

    // Fallback without offsetParent check (in case hidden during initial render)
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.isConnected) {
        return el;
      }
    }

    return null;
  }

  // ---- 7. Shorts Button State Manager ----
  function setShortsButtonState(container, state, labelText) {
    const btn = container.querySelector('.ytc-shorts-quick-btn');
    const iconEl = container.querySelector('.ytc-btn-icon');
    const labelEl = container.querySelector('.ytc-shorts-btn-label');

    if (btn) {
      btn.classList.remove('ytc-loading', 'ytc-success', 'ytc-error');
    }

    if (state === 'loading') {
      if (btn) btn.classList.add('ytc-loading');
      if (iconEl) iconEl.innerHTML = SPINNER_ICON_SVG;
      if (labelEl) labelEl.textContent = labelText || 'Copying...';
    } else if (state === 'success') {
      if (btn) btn.classList.add('ytc-success');
      if (iconEl) iconEl.innerHTML = CHECK_ICON_SVG;
      if (labelEl) labelEl.textContent = labelText || 'Copied!';
    } else if (state === 'error') {
      if (btn) btn.classList.add('ytc-error');
      if (iconEl) iconEl.innerHTML = ERROR_ICON_SVG;
      if (labelEl) labelEl.textContent = labelText || 'Error';
    } else {
      // idle
      if (iconEl) iconEl.innerHTML = TRANSCRIPT_ICON_SVG;
      if (labelEl) labelEl.textContent = labelText || 'Copy Transcript';
    }
  }

  // ---- 8. Shorts Video ID Resolution ----
  function getShortsVideoIdForElement(container) {
    // 1. Check parent ytd-reel-video-renderer
    const reel = container?.closest?.('ytd-reel-video-renderer') ||
                 container?.closest?.('[is-active]') ||
                 document.querySelector('ytd-reel-video-renderer[is-active]');

    if (reel) {
      const attrId = reel.getAttribute('video-id') ||
                     reel.getAttribute('data-video-id') ||
                     (reel.id && reel.id.length === 11 ? reel.id : null);
      if (attrId && /^[a-zA-Z0-9_-]{11}$/.test(attrId)) return attrId;

      const links = reel.querySelectorAll('a[href*="/shorts/"]');
      for (const link of links) {
        const m = link.href?.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
        if (m) return m[1];
      }

      if (reel.data?.videoId) return reel.data.videoId;
      if (reel.__data?.videoId) return reel.__data.videoId;
      if (reel.data?.overlay?.reelPlayerOverlayRenderer?.videoId) {
        return reel.data.overlay.reelPlayerOverlayRenderer.videoId;
      }
    }

    // 2. Check current page pathname
    const urlMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (urlMatch) return urlMatch[1];

    // 3. Fallback to active shorts video link
    const activeLink = document.querySelector('ytd-reel-video-renderer[is-active] a[href*="/shorts/"], ytd-shorts a[href*="/shorts/"]');
    if (activeLink?.href) {
      const m = activeLink.href.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }

    return null;
  }

  // ---- 9. Shorts Button Click Handler ----
  async function handleShortsButtonClick(e, button, container) {
    e.preventDefault();
    e.stopPropagation();

    if (isExtracting) return;
    isExtracting = true;

    setShortsButtonState(container, 'loading', 'Copying...');

    const videoId = getShortsVideoIdForElement(container);

    try {
      chrome.runtime.sendMessage({ action: 'quick-extract-and-copy', videoId }, (response) => {
        isExtracting = false;

        if (chrome.runtime.lastError || !response || !response.success) {
          const errReason = response?.error === 'no-transcript' || response?.error === 'no-captions-available'
            ? 'No Captions'
            : 'Copy failed';
          setShortsButtonState(container, 'error', errReason);
          showToast(
            response?.error === 'no-transcript' || response?.error === 'no-captions-available'
              ? 'No transcript found for this Short'
              : 'Could not extract transcript for Short',
            true
          );
          setTimeout(() => setShortsButtonState(container, 'idle', 'Copy Transcript'), 2600);
          return;
        }

        // Direct clipboard write fallback in user-gesture context
        if (response.formatted) {
          navigator.clipboard.writeText(response.formatted).catch(() => {});
        }

        setShortsButtonState(container, 'success', 'Copied!');
        const lineCountStr = response.linesCount ? ` (${response.linesCount} lines)` : '';
        showToast(`Shorts transcript copied to clipboard${lineCountStr}!`, false);
        incrementRatingUsageCount();

        setTimeout(() => setShortsButtonState(container, 'idle', 'Copy Transcript'), 2600);
      });
    } catch (err) {
      isExtracting = false;
      setShortsButtonState(container, 'error', 'Error');
      showToast('Extension communication error', true);
      setTimeout(() => setShortsButtonState(container, 'idle', 'Copy Transcript'), 2600);
    }
  }

  // ---- 10. Create Shorts Button Element ----
  function createShortsButtonElement() {
    const wrapper = document.createElement('div');
    wrapper.className = 'ytc-shorts-btn-container ytSpecButtonViewModelHost ytwReelActionBarViewModelHostDesktopActionButton';

    wrapper.innerHTML = `
      <label class="ytSpecButtonShapeWithLabelHost" style="display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; text-align: center;">
        <button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeL ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding ytc-shorts-quick-btn"
                type="button"
                title="Copy Shorts transcript to clipboard in 1 click"
                aria-label="Copy Shorts transcript">
          <div aria-hidden="true" class="ytSpecButtonShapeNextIcon ytc-btn-icon">
            <span class="ytIconWrapperHost" style="width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;">
              <span class="yt-icon-shape ytSpecIconShapeHost">
                <div style="width: 24px; height: 24px; display: block; fill: currentColor;">
                  ${TRANSCRIPT_ICON_SVG}
                </div>
              </span>
            </span>
          </div>
          <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse">
            <div class="ytSpecTouchFeedbackShapeStroke"></div>
            <div class="ytSpecTouchFeedbackShapeFill"></div>
          </yt-touch-feedback-shape>
        </button>
        <div class="ytSpecButtonShapeWithLabelLabel ytc-shorts-label-box">
          <span class="ytAttributedStringHost ytAttributedStringWhiteSpacePreWrap ytAttributedStringTextAlignmentCenter ytAttributedStringWordWrapping ytc-shorts-btn-label">Copy Transcript</span>
        </div>
      </label>
    `;

    return wrapper;
  }

  // ---- 11. Inject Shorts Buttons ----
  function injectShortsButtons() {
    if (!window.location.pathname.includes('/shorts')) return;

    injectStyles();

    const candidateSelectors = [
      'reel-action-bar-view-model.ytwReelActionBarViewModelHost',
      'reel-action-bar-view-model',
      '.ytReelPlayerOverlayViewModelActionsContainer reel-action-bar-view-model',
      '.ytReelPlayerOverlayViewModelActionsContainer',
      '#actions.ytd-reel-player-overlay-renderer',
      'ytd-reel-player-overlay-renderer #actions',
    ];

    const actionBars = document.querySelectorAll(candidateSelectors.join(', '));
    if (!actionBars || !actionBars.length) return;

    actionBars.forEach((bar) => {
      // If bar is outer container and contains a nested reel-action-bar-view-model, let the inner bar handle it
      if (bar.classList.contains('ytReelPlayerOverlayViewModelActionsContainer') && bar.querySelector('reel-action-bar-view-model')) {
        return;
      }

      // Check if already injected in this action bar
      if (bar.querySelector('.ytc-shorts-btn-container')) {
        return;
      }

      const wrapper = createShortsButtonElement();
      const button = wrapper.querySelector('button');
      if (button) {
        button.addEventListener('click', (e) => handleShortsButtonClick(e, button, wrapper));
      }

      // Preferred placement: right before pivot button (music/audio disc) or remix button
      const pivotBtn = bar.querySelector(
        'pivot-button-view-model, [aria-label*="sound" i], [aria-label*="audio" i], [aria-label*="track" i]'
      );

      if (pivotBtn && pivotBtn.parentNode === bar) {
        bar.insertBefore(wrapper, pivotBtn);
      } else {
        bar.appendChild(wrapper);
      }
    });
  }

  // ---- 12. Inject Watch Button ----
  function injectWatchButton() {
    // Only inject on watch pages
    if (!window.location.pathname.includes('/watch')) {
      const existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
      return false;
    }

    // Check if already present and connected
    const existing = document.getElementById(BUTTON_ID);
    if (existing && existing.isConnected) {
      return true;
    }

    const container = findActionBarContainer();
    if (!container) return false;

    injectStyles();

    // Create wrapper using YouTube's component tag
    const wrapper = document.createElement('yt-button-view-model');
    wrapper.className = 'ytd-menu-renderer ytc-transcript-btn-wrapper';
    wrapper.id = BUTTON_ID;

    wrapper.innerHTML = `
      <button-view-model class="ytSpecButtonViewModelHost style-scope ytd-menu-renderer">
        <button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconLeading ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding ytc-quick-btn"
                title="Copy video transcript to clipboard in 1 click"
                aria-label="Copy Transcript">
          <div aria-hidden="true" class="ytSpecButtonShapeNextIcon ytc-btn-icon">
            <span class="ytIconWrapperHost" style="width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;">
              <span class="yt-icon-shape ytSpecIconShapeHost">
                <div style="width: 100%; height: 100%; display: block; fill: currentcolor;">
                  ${TRANSCRIPT_ICON_SVG}
                </div>
              </span>
            </span>
          </div>
          <div class="ytSpecButtonShapeNextButtonTextContent ytc-btn-text">Copy Transcript</div>
          <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse">
            <div class="ytSpecTouchFeedbackShapeStroke"></div>
            <div class="ytSpecTouchFeedbackShapeFill"></div>
          </yt-touch-feedback-shape>
        </button>
      </button-view-model>
    `;

    const button = wrapper.querySelector('button');
    if (button) {
      button.addEventListener('click', (e) => handleButtonClick(e, button));
    }

    // Insert placement: Place after Share button if present, or append to container
    const shareBtn = container.querySelector('yt-button-view-model');
    if (shareBtn && shareBtn.nextSibling) {
      container.insertBefore(wrapper, shareBtn.nextSibling);
    } else {
      container.appendChild(wrapper);
    }

    return true;
  }

  // ---- 13. Inject All Appropriate Buttons ----
  function injectAllButtons() {
    if (window.location.pathname.includes('/watch')) {
      injectWatchButton();
    }
    if (window.location.pathname.includes('/shorts')) {
      injectShortsButtons();
    }
  }

  let lastAutoCopiedVideoId = null;

  function checkAndTriggerAutoCopy() {
    try {
      const url = window.location.href;
      if (!url.includes('/watch') && !url.includes('/shorts/')) return;

      const currentVideoId = (url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/shorts\/([a-zA-Z0-9_-]+)/))?.[1];
      if (!currentVideoId || currentVideoId === lastAutoCopiedVideoId) return;

      chrome.storage.local.get('userSettings', (data) => {
        if (chrome.runtime.lastError) return;
        const settings = data?.userSettings || {};
        if (settings.autoCopy) {
          lastAutoCopiedVideoId = currentVideoId;
          const btn = document.getElementById(BUTTON_ID) || document.querySelector('.ytc-quick-btn');
          if (btn) {
            handleButtonClick({ preventDefault() {}, stopPropagation() {} }, btn);
          } else {
            chrome.runtime.sendMessage({ action: 'quick-extract-and-copy', videoId: currentVideoId }, (response) => {
              if (response && response.success) {
                if (response.formatted) {
                  navigator.clipboard.writeText(response.formatted).catch(() => {});
                }
                const lineCountStr = response.linesCount ? ` (${response.linesCount} lines)` : '';
                showToast(`Transcript copied to clipboard${lineCountStr}!`, false);
                incrementRatingUsageCount();
              }
            });
          }
        }
      });
    } catch {}
  }

  // ---- 14. Lifecycle & SPA Navigation Observers ----
  function init() {
    injectAllButtons();

    // Fast polling on initial load
    let attempts = 0;
    const pollTimer = setInterval(() => {
      attempts++;
      injectAllButtons();
      if (attempts === 3 || attempts === 6) {
        checkAndTriggerAutoCopy();
      }
      if (attempts > 25) {
        clearInterval(pollTimer);
      }
    }, 400);

    // Listen to YouTube's Polymer SPA page transition events
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(injectAllButtons, 250);
      setTimeout(injectAllButtons, 800);
      setTimeout(injectAllButtons, 1800);
      setTimeout(checkAndTriggerAutoCopy, 1200);
      setTimeout(checkAndTriggerAutoCopy, 2500);
    });

    window.addEventListener('yt-page-data-updated', () => {
      setTimeout(injectAllButtons, 300);
      setTimeout(checkAndTriggerAutoCopy, 1200);
    });

    // Handle scroll for dynamically loaded Shorts reels
    let scrollThrottle = false;
    window.addEventListener('scroll', () => {
      if (!scrollThrottle && window.location.pathname.includes('/shorts')) {
        scrollThrottle = true;
        setTimeout(() => {
          injectShortsButtons();
          scrollThrottle = false;
        }, 300);
      }
    }, { passive: true });

    // MutationObserver to catch dynamic DOM additions
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldCheck = true;
          break;
        }
      }
      if (shouldCheck) {
        injectAllButtons();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
