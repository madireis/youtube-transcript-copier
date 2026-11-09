/**
 * Automated test suite for TranslatorEngine (v2.8.4)
 */

const TranslatorEngine = require('../translator_engine.js');
const assert = require('assert');

async function runTests() {
  console.log('🧪 Testing TranslatorEngine (v2.8.4)...');

  // Test 1: Supported Languages
  assert(Array.isArray(TranslatorEngine.SUPPORTED_LANGUAGES), 'SUPPORTED_LANGUAGES should be an array');
  assert(TranslatorEngine.SUPPORTED_LANGUAGES.length >= 25, 'Should support at least 25 languages');
  const es = TranslatorEngine.SUPPORTED_LANGUAGES.find(l => l.code === 'es');
  assert(es && es.name === 'Spanish', 'Should include Spanish');
  const ar = TranslatorEngine.SUPPORTED_LANGUAGES.find(l => l.code === 'ar');
  assert(ar && ar.rtl === true, 'Arabic should be marked RTL');
  console.log('  ✅ Test 1: Supported languages structure verified (' + TranslatorEngine.SUPPORTED_LANGUAGES.length + ' languages)');

  // Test 2: Translate real segments with timestamps
  const testSegments = [
    { timestamp: '00:00', text: 'Hello everyone.' },
    { timestamp: '00:04', text: 'Welcome to our tutorial on artificial intelligence.' },
    { timestamp: '00:10', text: 'Let us get started.' }
  ];

  let reportedProgress = [];
  const result = await TranslatorEngine.translateSegments(testSegments, 'es', {
    videoId: 'test_vid_123',
    onProgress: (p) => reportedProgress.push(p)
  });

  assert(result.success === true, 'Translation should succeed');
  assert(Array.isArray(result.segments), 'Result segments should be an array');
  assert.strictEqual(result.segments.length, testSegments.length, 'Length should match original segments');
  assert.strictEqual(result.segments[0].timestamp, '00:00', 'Timestamp should be preserved');
  assert.strictEqual(result.segments[1].timestamp, '00:04', 'Timestamp should be preserved');
  assert.strictEqual(result.segments[2].timestamp, '00:10', 'Timestamp should be preserved');
  assert(result.segments[0].text.length > 0, 'Translated text should not be empty');
  assert.strictEqual(result.segments[0].originalText, 'Hello everyone.', 'Original text should be kept in segment');
  assert(reportedProgress.includes(100), 'Progress should reach 100%');
  console.log('  ✅ Test 2: Real segment translation & timestamp alignment verified:');
  result.segments.forEach(s => console.log('     [' + s.timestamp + '] ' + s.text));

  // Test 3: Caching
  const cachedResult = await TranslatorEngine.translateSegments(testSegments, 'es', {
    videoId: 'test_vid_123'
  });
  assert(cachedResult.cached === true, 'Second call should come from in-memory cache');
  assert.strictEqual(cachedResult.engine, 'cache', 'Engine should report cache');
  console.log('  ✅ Test 3: In-memory cache verified');

  // Test 4: Clear Cache
  TranslatorEngine.clearCache('test_vid_123');
  // Cache is cleared

  console.log('\n🎉 ALL TRANSLATOR ENGINE TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
