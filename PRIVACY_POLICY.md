# Privacy Policy for YouTube Transcript Copier

**Last Updated:** September 2026  
**Extension Version:** 2.7.0

YouTube Transcript Copier ("the Extension") is committed to protecting your privacy. This Privacy Policy explains how information is handled when you use the Extension.

---

## 1. Zero Personal Data Collection & Zero Telemetry
- **No Personal Data Collected:** The Extension does **not** collect, harvest, transmit, store, or sell any personal information (such as names, email addresses, IP addresses, browsing histories, or hardware identifiers).
- **No Analytics / Telemetry:** The Extension does **not** use Google Analytics, Mixpanel, Sentry, or any other tracking, metric collection, or analytics libraries.
- **No Developer Servers:** The Extension operates without any developer-owned backends, servers, or cloud proxies. All processing takes place **locally** inside your browser instance.

---

## 2. Permissions & Data Handling

### `activeTab` & `scripting`
- Used solely to access the currently active YouTube tab when you trigger extraction, inspect the video container for transcripts/captions, and render the interactive toolbar and search viewer.
- The Extension never inspects background tabs or unauthorized domains.

### `storage` (Local Storage)
- Used entirely on your local device via Chrome's `chrome.storage.local` API to store:
  1. Your configuration preferences (formatting preferences, timestamp toggles, language choices).
  2. Saved workspaces and bookmarked video moments (two-tier local vault).
  3. Temporary pending prompt payload when you explicitly click "Send to AI" to bridge transcript text to ChatGPT, Claude, or Gemini.
- This data never leaves your device and can be cleared at any time via extension settings or browser cache controls.

### `sidePanel`
- Used to render the side-panel companion workspace when opened by the user.

### `downloads`
- Used exclusively when you click to download transcript files (SRT, VTT, JSON, CSV, MD, or batch ZIP archives) to your local downloads folder.

### `clipboardWrite`
- Used to copy formatted transcript text or Clip Notes directly to your system clipboard when you click "Copy Transcript" or "Copy".

### Host Permissions (`*.youtube.com`, `chatgpt.com`, `claude.ai`, `gemini.google.com`)
- `*://*.youtube.com/*`: Required to detect video elements, inject the 1-click "Copy Transcript" button, and fetch caption tracks directly from YouTube's official timedtext endpoints.
- `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`: Used exclusively to provide the optional, user-initiated 1-click AI workflow, injecting the transcript prompt into the chat prompt box when the corresponding AI provider page opens. No credentials, cookies, or chat histories are ever intercepted, recorded, or read.

---

## 3. Third-Party Web Services
When you choose to use the "Send to AI" feature, the transcript text is transferred locally within your browser to the web interface of the provider you select (ChatGPT, Claude, or Gemini). Your interaction with those third-party services is governed by their respective privacy policies and terms of service.

---

## 4. Single-Purpose Compliance
In strict accordance with Google Chrome Web Store Developer Policies, YouTube Transcript Copier has a single, transparent purpose: **providing fast, accurate, and versatile extraction of transcripts from YouTube videos for personal research and productivity**.

---

## 5. Contact & Open Inquiries
For questions, support, or bug reports regarding this extension, please submit an issue on the official project repository.
