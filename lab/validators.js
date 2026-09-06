/**
 * YouTube Compatibility Laboratory — Structural Validators
 * ========================================================
 * Checks output correctness without needing expected transcript text.
 * Each validator returns { passed: boolean, errors: string[] }
 */

const TIMESTAMP_REGEX = /^\d{1,2}:\d{2}(:\d{2})?$/;
const SRT_TIMESTAMP_REGEX = /^\d{2}:\d{2}:\d{2},\d{3}$/;
const VTT_TIMESTAMP_REGEX = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;
const HTML_ENTITY_REGEX = /&(amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);/gi;
const HTML_TAG_REGEX = /<[a-z\/][^>]*>/gi;

// ---- Extraction Validator ----
function validateExtraction(result) {
  const errors = [];

  if (!result) {
    return { passed: false, errors: ['Result is null/undefined'] };
  }

  if (result.success !== true) {
    return { passed: false, errors: [`Extraction failed: ${result.error || 'unknown'} ${result.detail || ''}`] };
  }

  if (!Array.isArray(result.lines)) {
    errors.push('result.lines is not an array');
  } else if (result.lines.length === 0) {
    errors.push('result.lines is empty');
  } else {
    // Check first 50 lines for structure
    const checkCount = Math.min(result.lines.length, 50);
    for (let i = 0; i < checkCount; i++) {
      const line = result.lines[i];
      if (typeof line.timestamp !== 'string') {
        errors.push(`Line ${i}: timestamp is not a string (${typeof line.timestamp})`);
        break;
      }
      if (typeof line.text !== 'string') {
        errors.push(`Line ${i}: text is not a string (${typeof line.text})`);
        break;
      }
      if (!line.text.trim()) {
        errors.push(`Line ${i}: text is empty/whitespace`);
      }
    }
  }

  if (typeof result.videoTitle !== 'string' || !result.videoTitle) {
    errors.push('videoTitle is missing or not a string');
  }

  if (typeof result.captionLanguage !== 'string') {
    errors.push('captionLanguage is missing');
  }

  return { passed: errors.length === 0, errors };
}

// ---- Normalization Validator ----
function validateNormalization(lines) {
  const errors = [];

  if (!Array.isArray(lines) || lines.length === 0) {
    return { passed: false, errors: ['No lines to validate'] };
  }

  let htmlEntityCount = 0;
  let htmlTagCount = 0;
  let badTimestampCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for unresolved HTML entities
    const entityMatches = line.text.match(HTML_ENTITY_REGEX);
    if (entityMatches) {
      htmlEntityCount++;
      if (htmlEntityCount <= 3) {
        errors.push(`Line ${i}: contains HTML entity "${entityMatches[0]}" in "${line.text.substring(0, 80)}"`);
      }
    }

    // Check for HTML tags
    const tagMatches = line.text.match(HTML_TAG_REGEX);
    if (tagMatches) {
      htmlTagCount++;
      if (htmlTagCount <= 3) {
        errors.push(`Line ${i}: contains HTML tag "${tagMatches[0]}" in "${line.text.substring(0, 80)}"`);
      }
    }

    // Check timestamp format
    if (!TIMESTAMP_REGEX.test(line.timestamp)) {
      badTimestampCount++;
      if (badTimestampCount <= 3) {
        errors.push(`Line ${i}: invalid timestamp format "${line.timestamp}"`);
      }
    }
  }

  if (htmlEntityCount > 3) errors.push(`...and ${htmlEntityCount - 3} more lines with HTML entities`);
  if (htmlTagCount > 3) errors.push(`...and ${htmlTagCount - 3} more lines with HTML tags`);
  if (badTimestampCount > 3) errors.push(`...and ${badTimestampCount - 3} more lines with bad timestamps`);

  return {
    passed: errors.length === 0,
    htmlEntitiesClean: htmlEntityCount === 0,
    htmlTagsClean: htmlTagCount === 0,
    timestampFormatValid: badTimestampCount === 0,
    errors,
  };
}

// ---- Formatter Validators ----

function validateLines(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  if (output.trim().length === 0) {
    return { passed: false, errors: ['Output is whitespace only'] };
  }

  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    errors.push('No non-empty lines in output');
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateParagraph(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  if (output.trim().length === 0) {
    return { passed: false, errors: ['Output is whitespace only'] };
  }

  // Paragraph mode should produce relatively few newlines compared to character count
  // (mostly one big block, maybe a header)
  const lines = output.split('\n').filter(l => l.trim());
  const bodyLines = lines.filter(l => !l.startsWith('📺') && !l.startsWith('🔗') && !l.startsWith('─'));

  // Body should be 1-3 lines for paragraph mode (one big text block)
  if (bodyLines.length > 5) {
    errors.push(`Paragraph mode produced ${bodyLines.length} body lines (expected 1-3)`);
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateCompact(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  if (output.trim().length === 0) {
    return { passed: false, errors: ['Output is whitespace only'] };
  }

  // Compact mode should have timestamp headers [M:SS] or [H:MM:SS]
  const timestampHeaders = output.match(/^\[[\d:]+\]$/gm);
  if (!timestampHeaders || timestampHeaders.length === 0) {
    errors.push('No timestamp headers [M:SS] found in compact output');
  }

  // Should have blank-line-separated blocks
  if (!output.includes('\n\n')) {
    errors.push('No block separators (double newlines) found in compact output');
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

// ---- Export Validators ----

function validateSRT(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  // SRT should have numbered blocks
  const blocks = output.split('\n\n').filter(b => b.trim());
  if (blocks.length === 0) {
    return { passed: false, errors: ['No SRT blocks found'] };
  }

  // Check first 10 blocks for structure
  const checkCount = Math.min(blocks.length, 10);
  for (let i = 0; i < checkCount; i++) {
    const lines = blocks[i].split('\n');
    if (lines.length < 3) {
      errors.push(`Block ${i + 1}: expected at least 3 lines, got ${lines.length}`);
      continue;
    }

    // Line 1: sequence number
    if (!/^\d+$/.test(lines[0].trim())) {
      errors.push(`Block ${i + 1}: first line is not a sequence number: "${lines[0]}"`);
    }

    // Line 2: timestamp range
    const tsLine = lines[1].trim();
    const tsParts = tsLine.split(' --> ');
    if (tsParts.length !== 2) {
      errors.push(`Block ${i + 1}: timestamp line missing " --> ": "${tsLine}"`);
    } else {
      if (!SRT_TIMESTAMP_REGEX.test(tsParts[0].trim())) {
        errors.push(`Block ${i + 1}: invalid start timestamp: "${tsParts[0]}"`);
      }
      if (!SRT_TIMESTAMP_REGEX.test(tsParts[1].trim())) {
        errors.push(`Block ${i + 1}: invalid end timestamp: "${tsParts[1]}"`);
      }
    }

    // Line 3+: text
    if (!lines[2].trim()) {
      errors.push(`Block ${i + 1}: text line is empty`);
    }
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateVTT(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  // Must start with WEBVTT
  if (!output.startsWith('WEBVTT')) {
    errors.push('VTT output does not start with "WEBVTT"');
  }

  // Check timestamp format
  const tsMatches = output.match(/\d{2}:\d{2}:\d{2}\.\d{3}/g);
  if (!tsMatches || tsMatches.length === 0) {
    errors.push('No VTT timestamps (HH:MM:SS.mmm) found');
  } else {
    for (let i = 0; i < Math.min(tsMatches.length, 10); i++) {
      if (!VTT_TIMESTAMP_REGEX.test(tsMatches[i])) {
        errors.push(`Invalid VTT timestamp: "${tsMatches[i]}"`);
      }
    }
  }

  // Check for --> arrows
  if (!output.includes(' --> ')) {
    errors.push('No " --> " timestamp separators found');
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateJSON(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    return { passed: false, errors: [`Invalid JSON: ${e.message}`] };
  }

  if (typeof parsed.title !== 'string') {
    errors.push('Missing or invalid "title" field');
  }

  if (typeof parsed.url !== 'string') {
    errors.push('Missing or invalid "url" field');
  }

  if (!Array.isArray(parsed.transcript)) {
    errors.push('Missing or invalid "transcript" array');
  } else if (parsed.transcript.length === 0) {
    errors.push('"transcript" array is empty');
  } else {
    const first = parsed.transcript[0];
    if (typeof first.timestamp !== 'string') {
      errors.push('First transcript entry missing "timestamp"');
    }
    if (typeof first.text !== 'string') {
      errors.push('First transcript entry missing "text"');
    }
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateCSV(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    return { passed: false, errors: ['CSV is empty'] };
  }

  // Header check
  if (lines[0].trim() !== 'Timestamp,Text') {
    errors.push(`CSV header should be "Timestamp,Text", got "${lines[0].trim()}"`);
  }

  if (lines.length < 2) {
    errors.push('CSV has header but no data rows');
  }

  // Check first 10 data rows
  const checkCount = Math.min(lines.length, 11);
  for (let i = 1; i < checkCount; i++) {
    const line = lines[i];
    // Should start with a quoted timestamp
    if (!line.startsWith('"')) {
      errors.push(`Row ${i}: does not start with a quoted field`);
    }
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

function validateMarkdown(output) {
  const errors = [];

  if (!output || typeof output !== 'string') {
    return { passed: false, errors: ['Output is empty or not a string'] };
  }

  if (!output.startsWith('# ')) {
    errors.push('Markdown does not start with "# " (H1 title)');
  }

  if (!output.includes('## Transcript')) {
    errors.push('Markdown missing "## Transcript" section');
  }

  // Should have list items
  const listItems = output.match(/^- /gm);
  if (!listItems || listItems.length === 0) {
    errors.push('Markdown has no list items "- "');
  }

  return { passed: errors.length === 0, charCount: output.length, errors };
}

module.exports = {
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
};
