#!/usr/bin/env node
/**
 * YouTube Compatibility Laboratory — Zero-Network CI Regression Runner (v2.7.0)
 * ===========================================================================
 * Validates:
 *   1. Normalization, formatting, and export pipeline across caption fixtures
 *   2. Search, snippet generation, timestamp mapping, and selection slicing
 *   3. First-class structured Clip Notes domain generation and token estimation
 *   4. Two-tier Storage Vault (index/payload separation and quota eviction)
 *   5. AI Web Bridge Provider Adapters (ChatGPT, Claude, Gemini)
 *
 * Runs in < 150ms with ZERO external network calls.
 *
 * Usage:
 *   node lab/ci_runner.js
 *   npm test
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  parseCaptionText,
  deduplicateLines,
  formatTranscript,
  exportToFormat,
} = require('./transcript_engine.js');

const {
  validateNormalization,
  validateLines,
  validateParagraph,
  validateCompact,
  validateSRT,
  validateVTT,
  validateJSON,
  validateCSV,
  validateMarkdown,
} = require('./validators.js');

const {
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
  pruneWorkspaces,
  estimateStorageBytes,
} = require('./search_engine.js');

const {
  AI_ACTION_PRESETS,
  LARGE_PAYLOAD_CHAR_THRESHOLD,
  LARGE_PAYLOAD_TOKEN_THRESHOLD,
  estimateTokens,
  buildTimestampUrl,
  generateStructuredClipNote,
  generateClipNotes,
  buildAiPayload,
} = require('./ai_workspace_engine.js');

const {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_PAYLOAD_PREFIX,
  LEGACY_STORAGE_KEY,
  MAX_SAVED_WORKSPACES,
  migrateLegacyStorage,
  getWorkspaceIndex,
  getWorkspacePayload,
  saveWorkspace,
  deleteWorkspace,
  renameWorkspace,
} = require('./storage_vault.js');

const {
  ChatGPTAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  resolveAdapter,
} = require('../ai_autopaste.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const DEFAULT_SETTINGS = {
  format: 'lines',
  timestamps: true,
  cleanDuplicates: true,
  title: true,
  url: true,
  promptPrepend: '',
};

function runCaptionFixture(fixtureName, rawContent) {
  const startTime = Date.now();

  // 1. Ingestion / Caption Parsing (JSON3 or XML)
  const lines = parseCaptionText(rawContent);
  if (!lines || lines.length === 0) {
    throw new Error(`Failed to parse caption segments from fixture ${fixtureName}`);
  }

  const data = {
    lines,
    videoTitle: `Test Video (${fixtureName})`,
    videoUrl: 'https://www.youtube.com/watch?v=TEST_FIXTURE',
  };

  // 2. Normalization & Sanitization Validation
  validateNormalization(lines);

  // 3. Deduplication Validation
  const deduped = deduplicateLines(lines);
  if (deduped.length > lines.length) {
    throw new Error(`Deduplication increased segment count in ${fixtureName}`);
  }

  // 4. Formatter Engine Validation
  const linesOutput = formatTranscript(data, { ...DEFAULT_SETTINGS, format: 'lines' });
  validateLines(linesOutput);

  const paraOutput = formatTranscript(data, { ...DEFAULT_SETTINGS, format: 'paragraph' });
  validateParagraph(paraOutput);

  const compactOutput = formatTranscript(data, { ...DEFAULT_SETTINGS, format: 'compact' });
  validateCompact(compactOutput);

  // 5. Downstream Exporters Validation
  const srtOutput = exportToFormat(data, 'srt', DEFAULT_SETTINGS);
  validateSRT(srtOutput);

  const vttOutput = exportToFormat(data, 'vtt', DEFAULT_SETTINGS);
  validateVTT(vttOutput);

  const jsonOutput = exportToFormat(data, 'json', DEFAULT_SETTINGS);
  validateJSON(jsonOutput);

  const csvOutput = exportToFormat(data, 'csv', DEFAULT_SETTINGS);
  validateCSV(csvOutput);

  const mdOutput = exportToFormat(data, 'md', DEFAULT_SETTINGS);
  validateMarkdown(mdOutput);

  const elapsed = Date.now() - startTime;
  console.log(`   ✅ [CAPTION] ${fixtureName.padEnd(26)} | ${String(lines.length).padStart(4)} segs | ${elapsed}ms`);
  return { fixtureName, type: 'caption', segments: lines.length, elapsed };
}

function runSearchFixture(fixtureName, rawContent) {
  const startTime = Date.now();
  const fixture = JSON.parse(rawContent);

  const testQuery = fixture.testQuery !== undefined ? fixture.testQuery : fixture.query;
  const expectedMatches = fixture.expectedMatches !== undefined ? fixture.expectedMatches : fixture.expectedMatchCount;
  const {
    expectedIndices,
    expectedTimestamp,
    expectedSeconds,
    expectedTotalOccurrences,
    segments,
  } = fixture;

  const results = searchTranscript(segments, testQuery);

  // Validate match count
  if (results.length !== expectedMatches) {
    throw new Error(
      `Search fixture [${fixtureName}] expected ${expectedMatches} matches for "${testQuery}", got ${results.length}`
    );
  }

  // Validate matched indices
  const resultIndices = results.map((r) => r.index);
  for (let i = 0; i < expectedIndices.length; i++) {
    if (resultIndices[i] !== expectedIndices[i]) {
      throw new Error(
        `Search fixture [${fixtureName}] expected index ${expectedIndices[i]}, got ${resultIndices[i]}`
      );
    }
  }

  // Validate timestamp mapping if specified
  if (expectedTimestamp !== undefined) {
    const match = results[0];
    if (!match || match.timestamp !== expectedTimestamp) {
      throw new Error(
        `Timestamp mapping failed in [${fixtureName}]: expected ${expectedTimestamp}, got ${match?.timestamp}`
      );
    }
    if (expectedSeconds !== undefined && match.startSeconds !== expectedSeconds) {
      throw new Error(
        `Seconds mapping failed in [${fixtureName}]: expected ${expectedSeconds}s, got ${match?.startSeconds}s`
      );
    }
  }

  // Validate total occurrences count if specified
  if (expectedTotalOccurrences !== undefined) {
    const totalOccurrences = results.reduce((sum, r) => sum + r.matchCount, 0);
    if (totalOccurrences !== expectedTotalOccurrences) {
      throw new Error(
        `Total occurrences mismatch in [${fixtureName}]: expected ${expectedTotalOccurrences}, got ${totalOccurrences}`
      );
    }
  }

  // Validate slicing & range tools
  const single = sliceSegment(segments, expectedIndices[0]);
  if (!single || single[0].text !== segments[expectedIndices[0]].text) {
    throw new Error(`sliceSegment failed for index ${expectedIndices[0]}`);
  }

  const fromIndex = sliceFrom(segments, expectedIndices[0]);
  if (fromIndex.length !== segments.length - expectedIndices[0]) {
    throw new Error(`sliceFrom length mismatch: expected ${segments.length - expectedIndices[0]}, got ${fromIndex.length}`);
  }

  const range = sliceRange(segments, expectedIndices);
  if (range.length !== expectedIndices.length) {
    throw new Error(`sliceRange length mismatch: expected ${expectedIndices.length}, got ${range.length}`);
  }

  // Validate bi-directional sliceRangeBiDirectional
  if (segments.length >= 3) {
    const forwardSlice = sliceRangeBiDirectional(segments, 0, 2);
    const backwardSlice = sliceRangeBiDirectional(segments, 2, 0);
    if (forwardSlice.length !== 3 || backwardSlice.length !== 3) {
      throw new Error(`sliceRangeBiDirectional length mismatch in [${fixtureName}]`);
    }
    if (forwardSlice[0].text !== backwardSlice[0].text || forwardSlice[2].text !== backwardSlice[2].text) {
      throw new Error(`sliceRangeBiDirectional symmetry failure in [${fixtureName}]`);
    }
  }

  // Validate playback tests if specified
  if (Array.isArray(fixture.playbackTests)) {
    for (const test of fixture.playbackTests) {
      const activeIdx = findActiveSegment(segments, test.currentSeconds);
      if (activeIdx !== test.expectedActiveIndex) {
        throw new Error(
          `findActiveSegment at ${test.currentSeconds}s in [${fixtureName}] expected index ${test.expectedActiveIndex}, got ${activeIdx}`
        );
      }
    }
  }

  // Validate marks tests if specified
  if (Array.isArray(fixture.markedIndices)) {
    const marked = filterMarkedSegments(segments, fixture.markedIndices);
    if (fixture.expectedMarkedCount !== undefined && marked.length !== fixture.expectedMarkedCount) {
      throw new Error(
        `filterMarkedSegments count mismatch in [${fixtureName}]: expected ${fixture.expectedMarkedCount}, got ${marked.length}`
      );
    }
    const summary = exportMarksSummary(segments, fixture.markedIndices, { title: 'Test Video' });
    if (!summary.includes('⭐') || !summary.includes('Marked Moments')) {
      throw new Error(`exportMarksSummary output malformed in [${fixtureName}]`);
    }
  }

  // Validate AI Context Payload Builder if specified
  if (Array.isArray(fixture.aiContextTests)) {
    for (const act of fixture.aiContextTests) {
      const payload = buildAiPayload({
        title: fixture.metadata?.title || 'Test Video',
        url: fixture.metadata?.url || 'https://youtube.com/watch?v=TEST',
        segments,
        scope: act.scope,
        selectedIndices: act.selectedIndices,
        markedIndices: act.markedIndices,
        singleIndex: act.singleIndex,
        actionKey: act.actionKey,
        customPrompt: act.customPrompt,
      });

      if (payload.segmentCount !== act.expectedSegmentCount) {
        throw new Error(
          `buildAiPayload segment count mismatch in [${fixtureName}] for test "${act.name}": expected ${act.expectedSegmentCount}, got ${payload.segmentCount}`
        );
      }

      // Assert Token Estimation & Large Payload safety attributes
      const estTokens = estimateTokens(payload.text);
      if (payload.estimatedTokens !== estTokens) {
        throw new Error(`estimateTokens mismatch in [${fixtureName}]: expected ${estTokens}, got ${payload.estimatedTokens}`);
      }

      if (Array.isArray(act.expectedMustContain)) {
        for (const str of act.expectedMustContain) {
          if (!payload.text.includes(str)) {
            throw new Error(
              `buildAiPayload missing expected substring in [${fixtureName}] for test "${act.name}": "${str}"`
            );
          }
        }
      }
    }
  }

  // Validate First-Class Structured Clip Notes generation if specified
  if (Array.isArray(fixture.expectedClipNotesElements)) {
    const structured = generateStructuredClipNote(segments, fixture.markedIndices, fixture.metadata || {});
    if (structured.schemaVersion !== 1) {
      throw new Error(`generateStructuredClipNote schemaVersion mismatch: expected 1, got ${structured.schemaVersion}`);
    }
    if (structured.momentCount !== fixture.markedIndices.length) {
      throw new Error(`generateStructuredClipNote momentCount mismatch: expected ${fixture.markedIndices.length}, got ${structured.momentCount}`);
    }
    if (typeof structured.estimatedTokens !== 'number' || structured.estimatedTokens <= 0) {
      throw new Error(`generateStructuredClipNote invalid estimatedTokens: ${structured.estimatedTokens}`);
    }

    const notes = structured.markdown;
    for (const elem of fixture.expectedClipNotesElements) {
      if (!notes.includes(elem)) {
        throw new Error(`generateClipNotes missing expected element in [${fixtureName}]: "${elem}"`);
      }
    }
  }

  // Formatting selection check
  const formattedWithTs = formatSelection(range, { includeTimestamps: true });
  const formattedNoTs = formatSelection(range, { includeTimestamps: false });
  if (!formattedWithTs.includes(`[${range[0].timestamp}]`)) {
    throw new Error(`formatSelection missing timestamp prefix`);
  }
  if (formattedNoTs.includes(`[${range[0].timestamp}]`)) {
    throw new Error(`formatSelection should not contain timestamp when includeTimestamps=false`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`   🔍 [SEARCH/AI] ${fixtureName.padEnd(26)} | query: "${testQuery.slice(0, 24)}" -> ${results.length} matches | ${elapsed}ms`);
  return { fixtureName, type: 'search', matches: results.length, elapsed };
}

// In-Memory Storage Adapter for Vault Unit Validation
class MockStorage {
  constructor() { this.data = {}; }
  async get(k) {
    if (typeof k === 'string') return { [k]: this.data[k] };
    if (Array.isArray(k)) {
      const res = {};
      k.forEach((key) => { res[key] = this.data[key]; });
      return res;
    }
    return { ...this.data };
  }
  async set(items) { Object.assign(this.data, items); }
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach((key) => delete this.data[key]);
  }
}

async function validateStorageVault() {
  const store = new MockStorage();

  // Test migration
  await store.set({
    [LEGACY_STORAGE_KEY]: [
      { id: 'leg_1', videoTitle: 'V1', lines: [{ text: 'L1' }], marks: [0] },
      { id: 'leg_2', videoTitle: 'V2', lines: [{ text: 'L2' }], marks: [] },
    ],
  });

  const migrated = await migrateLegacyStorage(store);
  assert.strictEqual(migrated, true);
  assert.strictEqual(store.data[LEGACY_STORAGE_KEY], undefined);

  const idx = await getWorkspaceIndex(store);
  assert.strictEqual(idx.length, 2);
  assert.strictEqual(idx[0].starred, true);

  const p1 = await getWorkspacePayload(store, 'leg_1');
  assert.strictEqual(p1.lines[0].text, 'L1');

  // Test save & FIFO quota
  await saveWorkspace(store, { id: 'leg_3', videoTitle: 'V3', lines: [{ text: 'L3' }], marks: [] }, 2);
  const idx2 = await getWorkspaceIndex(store);
  assert.strictEqual(idx2.length, 2);
  assert.strictEqual(idx2.some((w) => w.id === 'leg_1'), true, 'Starred workspace must survive quota eviction');
}

function validateAiAdapters() {
  const gpt = resolveAdapter('https://chatgpt.com/c/test');
  assert.ok(gpt instanceof ChatGPTAdapter);

  const claude = resolveAdapter('https://claude.ai/chat/test');
  assert.ok(claude instanceof ClaudeAdapter);

  const gemini = resolveAdapter('https://gemini.google.com/app');
  assert.ok(gemini instanceof GeminiAdapter);
}

async function main() {
  console.log('🧪 =================================================================');
  console.log('   YouTube Transcript Copier — Zero-Network CI Regression Suite (v2.7.0)');
  console.log('   =================================================================');

  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`❌ Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(FIXTURES_DIR).sort();
  const searchFiles = files.filter((f) => f.startsWith('search_') || f.startsWith('workspace_') || f.startsWith('ai_') || f.startsWith('clip_'));
  const captionFiles = files.filter((f) => !searchFiles.includes(f));

  const overallStart = Date.now();
  const summary = [];

  console.log(`\n📦 Executing ${captionFiles.length} Caption & Downstream Export Fixtures:`);
  for (const file of captionFiles) {
    const filePath = path.join(FIXTURES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    summary.push(runCaptionFixture(file, content));
  }

  console.log(`\n🔎 Executing ${searchFiles.length} Search, Navigation & Workspace Fixtures:`);
  for (const file of searchFiles) {
    const filePath = path.join(FIXTURES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    summary.push(runSearchFixture(file, content));
  }

  console.log('\n🏛️ Validating Two-Tier Storage Vault & AI Provider Adapters:');
  await validateStorageVault();
  console.log('   ✅ [VAULT] Two-Tier Index/Payload separation & FIFO quota verified');
  validateAiAdapters();
  console.log('   ✅ [ADAPTERS] ChatGPT, Claude, and Gemini polymorphic providers verified');

  const totalElapsed = Date.now() - overallStart;

  console.log('\n' + '═'.repeat(65));
  console.log(`  ALL ${summary.length} FIXTURES + ARCHITECTURAL AUDIT GATES PASSED`);
  console.log(`  Caption Pipelines Tested: ${captionFiles.length} (Fidelity: 100.0%)`);
  console.log(`  Search & Workspace:       ${searchFiles.length} (100% of expected fixture outcomes)`);
  console.log(`  Storage Vault & Adapters: 100% Pass`);
  console.log(`  Total Execution Time:     ${totalElapsed}ms`);
  console.log('═'.repeat(65) + '\n');
}

main().catch((err) => {
  console.error('❌ CI Suite failed:', err);
  process.exit(1);
});
