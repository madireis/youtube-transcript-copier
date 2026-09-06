/**
 * YouTube Transcript Copier — Storage Vault (v2.7.0)
 * ==================================================
 * Two-tier storage architecture separating lightweight metadata index
 * from heavyweight transcript payloads.
 *
 * Prevents Chrome storage single-item quota exhaustion and reduces I/O lag.
 * Fully compatible with Chrome chrome.storage.local and test mock storage.
 */

const WORKSPACE_INDEX_KEY = 'workspace_index';
const WORKSPACE_PAYLOAD_PREFIX = 'ws_payload_';
const LEGACY_STORAGE_KEY = 'saved_workspaces';
const MAX_SAVED_WORKSPACES = 30;
const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // 4MB warning threshold

/**
 * Estimates byte size of any serializable object.
 */
function estimateBytes(data) {
  try {
    if (typeof Blob !== 'undefined') {
      return new Blob([JSON.stringify(data)]).size;
    }
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Normalizes storage interface (supports chrome.storage.local promise API or mock object).
 */
function createStorageAdapter(rawStorage) {
  if (!rawStorage) {
    throw new Error('Storage backend required');
  }

  return {
    async get(keys) {
      if (typeof rawStorage.get === 'function') {
        const res = await rawStorage.get(keys);
        return res || {};
      }
      return {};
    },
    async set(items) {
      if (typeof rawStorage.set === 'function') {
        return await rawStorage.set(items);
      }
    },
    async remove(keys) {
      if (typeof rawStorage.remove === 'function') {
        return await rawStorage.remove(keys);
      }
    },
  };
}

/**
 * Migrates legacy monolithic 'saved_workspaces' array to the two-tier structure.
 */
async function migrateLegacyStorage(rawStorage) {
  const storage = createStorageAdapter(rawStorage);
  const data = await storage.get(LEGACY_STORAGE_KEY);
  const legacyList = data[LEGACY_STORAGE_KEY];

  if (!Array.isArray(legacyList) || legacyList.length === 0) {
    return false; // Nothing to migrate
  }

  console.log(`[Storage Vault] Migrating ${legacyList.length} legacy workspaces to two-tier schema...`);

  const index = [];
  const payloadEntries = {};

  for (const item of legacyList) {
    if (!item || typeof item !== 'object' || !item.id || !Array.isArray(item.lines)) continue;

    const id = item.id;
    const marks = Array.isArray(item.marks) ? item.marks : [];
    const selectedIndices = Array.isArray(item.selectedIndices) ? item.selectedIndices : [];
    const charCount = item.lines.reduce((acc, l) => acc + (l.text ? l.text.length : 0), 0);

    index.push({
      id,
      videoId: item.videoId || '',
      videoTitle: item.videoTitle || 'Untitled Transcript',
      videoUrl: item.videoUrl || '',
      savedAt: item.savedAt || Date.now(),
      segmentCount: item.lines.length,
      markCount: marks.length,
      charCount,
      starred: marks.length > 0,
    });

    payloadEntries[`${WORKSPACE_PAYLOAD_PREFIX}${id}`] = {
      id,
      lines: item.lines,
      marks,
      selectedIndices,
    };
  }

  // Save index and payloads atomically
  await storage.set({
    [WORKSPACE_INDEX_KEY]: index,
    ...payloadEntries,
  });

  // Remove legacy key
  await storage.remove(LEGACY_STORAGE_KEY);
  console.log('[Storage Vault] Migration complete.');
  return true;
}

/**
 * Retrieves the lightweight workspace catalog.
 */
async function getWorkspaceIndex(rawStorage) {
  const storage = createStorageAdapter(rawStorage);
  // Check migration first
  await migrateLegacyStorage(rawStorage);

  const res = await storage.get(WORKSPACE_INDEX_KEY);
  const raw = res[WORKSPACE_INDEX_KEY];
  if (!Array.isArray(raw)) return [];

  return raw.filter((item) => item && typeof item === 'object' && typeof item.id === 'string');
}

/**
 * Retrieves full transcript payload for a given workspace id.
 */
async function getWorkspacePayload(rawStorage, id) {
  if (!id) return null;
  const storage = createStorageAdapter(rawStorage);
  const key = `${WORKSPACE_PAYLOAD_PREFIX}${id}`;
  const res = await storage.get(key);
  return res[key] || null;
}

/**
 * Saves or updates a workspace into the two-tier vault.
 * Enforces quota: keeps maximum `maxLimit` workspaces, evicting unstarred first.
 */
async function saveWorkspace(rawStorage, {
  id,
  videoId = '',
  videoTitle = 'Untitled Transcript',
  videoUrl = '',
  lines = [],
  marks = [],
  selectedIndices = [],
}, maxLimit = MAX_SAVED_WORKSPACES) {
  if (!id || !Array.isArray(lines) || lines.length === 0) {
    throw new Error('Valid workspace id and non-empty lines required');
  }

  const storage = createStorageAdapter(rawStorage);
  const index = await getWorkspaceIndex(rawStorage);

  const cleanMarks = Array.isArray(marks) ? marks : Array.from(marks || []);
  const cleanSelected = Array.isArray(selectedIndices) ? selectedIndices : Array.from(selectedIndices || []);
  const charCount = lines.reduce((sum, l) => sum + (l.text ? l.text.length : 0), 0);

  const metaEntry = {
    id,
    videoId,
    videoTitle: (videoTitle || 'Untitled Transcript').trim(),
    videoUrl: (videoUrl || '').trim(),
    savedAt: Date.now(),
    segmentCount: lines.length,
    markCount: cleanMarks.length,
    charCount,
    starred: cleanMarks.length > 0,
  };

  const payload = {
    id,
    lines,
    marks: cleanMarks,
    selectedIndices: cleanSelected,
  };

  // Upsert index
  const existingIdx = index.findIndex((item) => item.id === id || (videoId && item.videoId === videoId));
  if (existingIdx !== -1) {
    index[existingIdx] = metaEntry;
  } else {
    index.unshift(metaEntry);
  }

  // Enforce quota eviction if over limit (FIFO: oldest unstarred first)
  const keysToRemove = [];
  while (index.length > maxLimit) {
    let oldestUnstarredIdx = -1;
    let oldestTime = Infinity;
    for (let i = index.length - 1; i >= 0; i--) {
      const item = index[i];
      if (!item.starred && (!item.markCount || item.markCount === 0)) {
        if (item.savedAt <= oldestTime) {
          oldestTime = item.savedAt;
          oldestUnstarredIdx = i;
        }
      }
    }
    const targetIdx = oldestUnstarredIdx !== -1 ? oldestUnstarredIdx : (index.length - 1);
    const evicted = index.splice(targetIdx, 1)[0];
    if (evicted && evicted.id !== id) {
      keysToRemove.push(`${WORKSPACE_PAYLOAD_PREFIX}${evicted.id}`);
    }
  }

  // Atomic write of index + new payload
  const writes = {
    [WORKSPACE_INDEX_KEY]: index,
    [`${WORKSPACE_PAYLOAD_PREFIX}${id}`]: payload,
  };

  await storage.set(writes);

  if (keysToRemove.length > 0) {
    await storage.remove(keysToRemove);
  }

  return { index, payload, evictedCount: keysToRemove.length };
}

/**
 * Deletes a workspace and cleans up its payload key.
 */
async function deleteWorkspace(rawStorage, id) {
  if (!id) return false;
  const storage = createStorageAdapter(rawStorage);
  const index = await getWorkspaceIndex(rawStorage);

  const updatedIndex = index.filter((w) => w.id !== id);
  await storage.set({ [WORKSPACE_INDEX_KEY]: updatedIndex });
  await storage.remove(`${WORKSPACE_PAYLOAD_PREFIX}${id}`);
  return true;
}

/**
 * Renames a workspace in the index metadata.
 */
async function renameWorkspace(rawStorage, id, newTitle) {
  if (!id || !newTitle || !newTitle.trim()) return false;
  const storage = createStorageAdapter(rawStorage);
  const index = await getWorkspaceIndex(rawStorage);

  const target = index.find((w) => w.id === id);
  if (!target) return false;

  target.videoTitle = newTitle.trim();
  await storage.set({ [WORKSPACE_INDEX_KEY]: index });
  return true;
}


if (typeof window !== 'undefined') {
  window.StorageVault = {
    WORKSPACE_INDEX_KEY,
    WORKSPACE_PAYLOAD_PREFIX,
    LEGACY_STORAGE_KEY,
    MAX_SAVED_WORKSPACES,
    STORAGE_WARN_BYTES,
    estimateBytes,
    migrateLegacyStorage,
    getWorkspaceIndex,
    getWorkspacePayload,
    saveWorkspace,
    deleteWorkspace,
    renameWorkspace,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WORKSPACE_INDEX_KEY,
    WORKSPACE_PAYLOAD_PREFIX,
    LEGACY_STORAGE_KEY,
    MAX_SAVED_WORKSPACES,
    STORAGE_WARN_BYTES,
    estimateBytes,
    migrateLegacyStorage,
    getWorkspaceIndex,
    getWorkspacePayload,
    saveWorkspace,
    deleteWorkspace,
    renameWorkspace,
  };
}
