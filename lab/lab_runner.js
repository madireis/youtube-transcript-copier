#!/usr/bin/env node
/**
 * YouTube Compatibility Laboratory — Test Runner
 * ================================================
 * Runs the full extraction → normalization → formatter → exporter pipeline
 * against the test corpus and records structured results.
 *
 * Usage:
 *   node lab/lab_runner.js                    # Run full corpus
 *   node lab/lab_runner.js --resume           # Continue from last checkpoint
 *   node lab/lab_runner.js --id dQw4w9WgXcQ   # Test single video
 *   node lab/lab_runner.js --category short   # Test one category
 *   node lab/lab_runner.js --delay 3000       # 3s between requests (default: 2000)
 *   node lab/lab_runner.js --concise          # Minimal console output
 */

const fs = require('fs');
const path = require('path');

const {
  fetchTranscriptForVideo,
  deduplicateLines,
  formatTranscript,
  exportToFormat,
  parseTimestampToSeconds,
} = require('./transcript_engine.js');

const {
  validateExtraction,
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

// ---- CLI Arguments ----
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  if (idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return true;
}

const SINGLE_ID = getArg('id');
const CATEGORY_FILTER = getArg('category');
const RESUME = args.includes('--resume');
const DELAY_MS = parseInt(getArg('delay'), 10) || 2000;
const CONCISE = args.includes('--concise');

// ---- Paths ----
const LAB_DIR = __dirname;
const CORPUS_PATH = path.join(LAB_DIR, 'test_corpus.json');
const RESULTS_DIR = path.join(LAB_DIR, 'results');
const RESULTS_PATH = path.join(RESULTS_DIR, 'lab_results.jsonl');

// ---- Helpers ----
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCorpus() {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  return JSON.parse(raw);
}

function getCompletedIds() {
  if (!fs.existsSync(RESULTS_PATH)) return new Set();
  const lines = fs.readFileSync(RESULTS_PATH, 'utf8').split('\n').filter(Boolean);
  const ids = new Set();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      ids.add(obj.videoId);
    } catch {}
  }
  return ids;
}

function appendResult(result) {
  fs.appendFileSync(RESULTS_PATH, JSON.stringify(result) + '\n', 'utf8');
}

// ---- Default settings for formatters/exporters ----
const DEFAULT_SETTINGS = {
  format: 'lines',
  timestamps: true,
  cleanDuplicates: true,
  title: true,
  url: true,
  promptPrepend: '',
};

// ---- Test a single video ----
async function testVideo(entry) {
  const { id, category, description } = entry;
  const startTime = Date.now();

  const result = {
    videoId: id,
    category,
    description,
    timestamp: new Date().toISOString(),
    extraction: null,
    normalization: null,
    formatters: {},
    exporters: {},
    error: null,
    durationMs: 0,
  };

  try {
    // 1. EXTRACTION
    const data = await fetchTranscriptForVideo(id);
    const extractionValidation = validateExtraction(data);

    result.extraction = {
      success: data.success,
      error: data.error || null,
      detail: data.detail || null,
      strategyUsed: data.strategyUsed || null,
      captionLanguage: data.captionLanguage || null,
      captionKind: data.captionKind || null,
      segmentCount: data.lines?.length || 0,
      charCount: data.lines ? data.lines.reduce((sum, l) => sum + l.text.length, 0) : 0,
      firstTimestamp: data.lines?.[0]?.timestamp || null,
      lastTimestamp: data.lines?.[data.lines.length - 1]?.timestamp || null,
      durationSeconds: data.lines?.length > 0
        ? parseTimestampToSeconds(data.lines[data.lines.length - 1].timestamp)
        : 0,
      availableTrackCount: data.availableTracks?.length || 0,
      validationPassed: extractionValidation.passed,
      validationErrors: extractionValidation.errors,
    };

    // If extraction failed, skip formatting/export tests
    if (!data.success || !data.lines || data.lines.length === 0) {
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // 2. NORMALIZATION
    const normResult = validateNormalization(data.lines);
    result.normalization = {
      passed: normResult.passed,
      htmlEntitiesClean: normResult.htmlEntitiesClean,
      htmlTagsClean: normResult.htmlTagsClean,
      timestampFormatValid: normResult.timestampFormatValid,
      errors: normResult.errors,
    };

    // 3. FORMATTERS (lines, paragraph, compact)
    const formatModes = ['lines', 'paragraph', 'compact'];
    const formatValidators = { lines: validateLines, paragraph: validateParagraph, compact: validateCompact };

    for (const mode of formatModes) {
      try {
        const settings = { ...DEFAULT_SETTINGS, format: mode };
        const output = formatTranscript(data, settings);
        const validation = formatValidators[mode](output);
        result.formatters[mode] = {
          passed: validation.passed,
          charCount: validation.charCount || output.length,
          errors: validation.errors,
        };
      } catch (err) {
        result.formatters[mode] = {
          passed: false,
          charCount: 0,
          errors: [`Exception: ${err.message}`],
        };
      }
    }

    // 4. EXPORTERS (srt, vtt, json, csv, md)
    const exportFormats = ['srt', 'vtt', 'json', 'csv', 'md'];
    const exportValidators = { srt: validateSRT, vtt: validateVTT, json: validateJSON, csv: validateCSV, md: validateMarkdown };

    for (const format of exportFormats) {
      try {
        const output = exportToFormat(data, format, DEFAULT_SETTINGS);
        const validation = exportValidators[format](output);
        result.exporters[format] = {
          passed: validation.passed,
          charCount: validation.charCount || output.length,
          errors: validation.errors,
        };
      } catch (err) {
        result.exporters[format] = {
          passed: false,
          charCount: 0,
          errors: [`Exception: ${err.message}`],
        };
      }
    }
  } catch (err) {
    result.error = `Unhandled exception: ${err.message}`;
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ---- Console output helpers ----
function statusIcon(passed) {
  return passed ? '✅' : '❌';
}

function printResult(result, index, total) {
  const { videoId, category, description, extraction } = result;
  const prefix = `[${String(index + 1).padStart(3)}/${total}]`;

  if (!extraction || !extraction.success) {
    const err = extraction?.error || result.error || 'unknown';
    console.log(`${prefix} ❌ ${videoId} (${category}) — ${err}`);
    return;
  }

  if (CONCISE) {
    const allPassed = result.normalization?.passed &&
      Object.values(result.formatters).every(f => f.passed) &&
      Object.values(result.exporters).every(e => e.passed);
    console.log(`${prefix} ${statusIcon(allPassed)} ${videoId} (${category}) — ${extraction.segmentCount} segs, ${extraction.captionLanguage}`);
    return;
  }

  const normIcon = statusIcon(result.normalization?.passed);
  const fmtIcons = Object.entries(result.formatters).map(([k, v]) => `${k}:${statusIcon(v.passed)}`).join(' ');
  const expIcons = Object.entries(result.exporters).map(([k, v]) => `${k}:${statusIcon(v.passed)}`).join(' ');

  console.log(`${prefix} ${statusIcon(true)} ${videoId} (${category})`);
  console.log(`       📊 ${extraction.segmentCount} segments | ${extraction.charCount} chars | ${extraction.captionLanguage} | ${extraction.firstTimestamp}→${extraction.lastTimestamp}`);
  console.log(`       🔍 norm:${normIcon} | fmt: ${fmtIcons}`);
  console.log(`       📦 exp: ${expIcons}`);

  // Print errors if any
  const allErrors = [];
  if (result.normalization && !result.normalization.passed) {
    allErrors.push(...result.normalization.errors.slice(0, 2));
  }
  for (const [k, v] of Object.entries(result.formatters)) {
    if (!v.passed) allErrors.push(...v.errors.slice(0, 1).map(e => `${k}: ${e}`));
  }
  for (const [k, v] of Object.entries(result.exporters)) {
    if (!v.passed) allErrors.push(...v.errors.slice(0, 1).map(e => `${k}: ${e}`));
  }
  if (allErrors.length > 0) {
    for (const err of allErrors.slice(0, 5)) {
      console.log(`       ⚠️  ${err}`);
    }
  }
}

// ---- Main ----
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   YouTube Compatibility Laboratory v1.0          ║');
  console.log('║   YouTube Transcript Copier v2.3.0               ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Load corpus
  let corpus = loadCorpus();
  console.log(`📋 Loaded ${corpus.length} videos from test corpus`);

  // Filter by single ID
  if (SINGLE_ID) {
    corpus = corpus.filter(e => e.id === SINGLE_ID);
    if (corpus.length === 0) {
      // Allow testing arbitrary IDs not in corpus
      corpus = [{ id: SINGLE_ID, category: 'manual', description: `Manual test: ${SINGLE_ID}`, expectedCaptions: true, expectedLanguage: null }];
    }
    console.log(`🎯 Single video mode: ${SINGLE_ID}`);
  }

  // Filter by category
  if (CATEGORY_FILTER) {
    corpus = corpus.filter(e => e.category === CATEGORY_FILTER);
    console.log(`🏷️  Category filter: ${CATEGORY_FILTER} (${corpus.length} videos)`);
  }

  // Resume mode
  let completedIds = new Set();
  if (RESUME) {
    completedIds = getCompletedIds();
    const before = corpus.length;
    corpus = corpus.filter(e => !completedIds.has(e.id));
    console.log(`⏩ Resume mode: skipping ${before - corpus.length} already-tested videos`);
  } else if (!SINGLE_ID) {
    // Clear previous results for full run
    if (fs.existsSync(RESULTS_PATH)) {
      fs.writeFileSync(RESULTS_PATH, '', 'utf8');
    }
  }

  if (corpus.length === 0) {
    console.log('✅ Nothing to test — all videos already processed or no matches.');
    return;
  }

  console.log(`⏱️  Delay: ${DELAY_MS}ms between requests`);
  console.log(`📊 Estimated time: ~${Math.ceil((corpus.length * DELAY_MS) / 60000)} minutes`);
  console.log('─'.repeat(55));
  console.log('');

  // Deduplicate corpus (same ID in multiple categories → test once, record under first category)
  const seen = new Set();
  const dedupedCorpus = [];
  for (const entry of corpus) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      dedupedCorpus.push(entry);
    }
  }

  if (dedupedCorpus.length < corpus.length) {
    console.log(`📌 Deduplicated: ${corpus.length} entries → ${dedupedCorpus.length} unique videos`);
    console.log('');
  }

  const total = dedupedCorpus.length;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < total; i++) {
    const entry = dedupedCorpus[i];

    try {
      const result = await testVideo(entry);
      appendResult(result);
      printResult(result, i, total);

      if (result.extraction?.success) {
        const allPassed = result.normalization?.passed &&
          Object.values(result.formatters).every(f => f.passed) &&
          Object.values(result.exporters).every(e => e.passed);
        if (allPassed) passed++;
        else failed++;
      } else {
        // Check if failure was expected
        if (!entry.expectedCaptions) {
          skipped++;
        } else {
          failed++;
        }
      }
    } catch (err) {
      console.log(`[${String(i + 1).padStart(3)}/${total}] 💥 ${entry.id} — CRASH: ${err.message}`);
      appendResult({
        videoId: entry.id,
        category: entry.category,
        description: entry.description,
        timestamp: new Date().toISOString(),
        extraction: { success: false, error: 'runner-crash', detail: err.message },
        normalization: null,
        formatters: {},
        exporters: {},
        error: err.message,
        durationMs: 0,
      });
      failed++;
    }

    // Delay between requests (skip on last)
    if (i < total - 1) {
      await sleep(DELAY_MS);
    }
  }

  // ---- Summary ----
  console.log('');
  console.log('═'.repeat(55));
  console.log('  📊 SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Total tested:    ${total}`);
  console.log(`  ✅ Full pass:    ${passed}`);
  console.log(`  ❌ Failed:       ${failed}`);
  console.log(`  ⏭️  Expected no-captions: ${skipped}`);
  console.log(`  📈 Pass rate:    ${total > 0 ? ((passed / (total - skipped)) * 100).toFixed(1) : 0}% (of videos expected to have captions)`);
  console.log('');
  console.log(`  Results saved to: ${RESULTS_PATH}`);
  console.log(`  Run "node lab/lab_report.js" for detailed analysis.`);
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
