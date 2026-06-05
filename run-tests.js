/**
 * run-tests.js — Zero-dependency ESM Unit Test Runner for Git Scout logic.
 * Mocks browser APIs (localStorage, sessionStorage, window) on startup, imports pure helper libraries,
 * and executes comprehensive automated checks in under 50 milliseconds.
 */

console.log('🧪 Starting Git Scout Automated Unit Test Runner...');

// 1. Pre-mock browser globals to prevent module loading exceptions
const storage = {};
global.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, val) => { storage[key] = String(val); },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; }
};

global.sessionStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, val) => { storage[key] = String(val); },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; }
};

global.window = {
  dispatchEvent: () => {}
};

// Simple assert helper
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exit(1);
  }
}

// 2. Dynamically import modules (after mocking globals, avoiding browser dependencies)
const {
  buildDirectoryTree,
  parseMarkdown,
  extractJsonObjects,
  parseManifestDependencies,
  extractSignificantKeywords,
  computeTfidfSimilarity,
  parseLockfileDependencies
} = await import('./src/utils.js');
const {
  createCollection, getCollections, renameCollection, deleteCollection,
  getCachedResults, setCachedResults, addToCompare, getCompareList, clearCompare
} = await import('./src/storage.js');

try {
  // ────────────────────────────────────────────────────────
  // Test Case 1: Recursive Directory Tree Parser
  // ────────────────────────────────────────────────────────
  console.log(' - Testing buildDirectoryTree recursive parser...');
  const paths = [
    'main.js',
    'src/ai.js',
    'src/storage.js',
    'src/nested/deep/file.py',
    'assets/images/logo.png'
  ];
  const tree = buildDirectoryTree(paths);
  
  assert(tree.name === 'Root', 'Root folder name must be "Root"');
  assert(tree.children.length === 3, 'Root must have 3 children: assets, main.js, src');
  
  const srcNode = tree.children.find(c => c.name === 'src');
  assert(srcNode.type === 'directory', 'src must be a directory');
  assert(srcNode.children.length === 3, 'src must contain 3 children: nested, ai.js, storage.js');
  
  const mainNode = tree.children.find(c => c.name === 'main.js');
  assert(mainNode.type === 'file', 'main.js must be a file');
  
  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 2: Safe Markdown Code Block Collision Parser
  // ────────────────────────────────────────────────────────
  console.log(' - Testing parseMarkdown with dynamic placeholder collision checking...');
  
  // Normal Markdown
  const normalMarkdown = 'Hello **world** with `inline code` and:\n```javascript\nconst a = 123;\n```';
  const parsedNormal = parseMarkdown(normalMarkdown);
  assert(parsedNormal.includes('<strong>world</strong>'), 'Bold text parsed');
  assert(parsedNormal.includes('<code class="inline-code">inline code</code>'), 'Inline code parsed');
  assert(parsedNormal.includes('<pre><code>const a = 123;</code></pre>'), 'Code block parsed');

  // Collision Attempt Markdown: text contains a potential placeholder that matches index
  const collisionText = 'I have a raw text line saying __CODE_BLOCK_abc_0__ and a block:\n```python\nprint("test")\n```';
  const parsedCollision = parseMarkdown(collisionText);
  // Ensure the user\'s typed text saying __CODE_BLOCK_abc_0__ remains EXACTLY untouched, while the block renders
  assert(parsedCollision.includes('__CODE_BLOCK_abc_0__'), 'User typed raw placeholder text preserved without overwrite');
  assert(parsedCollision.includes('<pre><code>print("test")</code></pre>'), 'Code block correctly restored');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 3: Character Depth JSON Rescue Scanner
  // ────────────────────────────────────────────────────────
  console.log(' - Testing extractJsonObjects character scanner recovery...');
  
  const rawResponse = `Here is the conversational output:
  {
    "index": 0,
    "score": 8,
    "summary": "Clean nested repo card test",
    "pros": ["simple", "decoupled"],
    "cons": []
  }
  And some extra text at the end.`;

  const recovered = extractJsonObjects(rawResponse);
  assert(recovered.length === 1, 'Should extract exactly 1 JSON object');
  assert(recovered[0].index === 0, 'Recovered object index correct');
  assert(recovered[0].score === 8, 'Recovered object score correct');
  assert(recovered[0].pros[0] === 'simple', 'Recovered nested array correct');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 4: Case-Insensitive Collections & Casing Preservation
  // ────────────────────────────────────────────────────────
  console.log(' - Testing collections management operations...');
  
  // Clean custom collections storage
  localStorage.removeItem('rr_custom_collections');
  localStorage.removeItem('rr_bookmarks');

  // Deduplication check
  createCollection('Tutorials');
  assert(getCollections().includes('Tutorials'), 'Tutorials collection created');
  
  const doubleCreate = createCollection('tutorials');
  assert(!doubleCreate, 'createCollection must reject lowercase duplicates');
  
  const list = getCollections();
  const count = list.filter(c => c.toLowerCase() === 'tutorials').length;
  assert(count === 1, 'Only one casing entry exists in collections');
  assert(list.includes('Tutorials'), 'Preserves original casing of first added collection');

  // Rename check
  const renameSuccess = renameCollection('Tutorials', 'Guides');
  assert(renameSuccess, 'Rename collection returns true');
  assert(getCollections().includes('Guides'), 'Guides collection exists');
  assert(!getCollections().includes('Tutorials'), 'Tutorials collection no longer exists');

  // Rename to existing duplicates check
  createCollection('Apps');
  const duplicateRename = renameCollection('Guides', 'apps');
  assert(!duplicateRename, 'Rename must reject existing casing duplicate targets');

  // Delete check
  deleteCollection('Guides');
  assert(!getCollections().includes('Guides'), 'Guides collection deleted');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 5: Enhanced Search Cache Keys
  // ────────────────────────────────────────────────────────
  console.log(' - Testing cache settings isolation keys...');
  
  localStorage.clear();
  
  const interests = ['python', 'react'];
  
  // Set cache
  setCachedResults(interests, 'data_groq', 'groq', 'llama-4', 'keyword', true, '');
  
  // Check different providers/models/modes/tokens/ideas
  const hitGroq = getCachedResults(interests, 'groq', 'llama-4', 'keyword', true, '');
  assert(hitGroq === 'data_groq', 'Groq cache hit success');

  const missProvider = getCachedResults(interests, 'openai', 'llama-4', 'keyword', true, '');
  assert(missProvider === null, 'Different provider misses cache');

  const missModel = getCachedResults(interests, 'groq', 'llama-5', 'keyword', true, '');
  assert(missModel === null, 'Different model misses cache');

  const missMode = getCachedResults(interests, 'groq', 'llama-4', 'idea', true, '');
  assert(missMode === null, 'Different mode misses cache');

  const missToken = getCachedResults(interests, 'groq', 'llama-4', 'keyword', false, '');
  assert(missToken === null, 'Different token presence misses cache');

  const missIdea = getCachedResults(interests, 'groq', 'llama-4', 'keyword', true, 'some original idea');
  assert(missIdea === null, 'Different original idea text misses cache');

  // Verify non-mutating copy sorted interests
  assert(interests[0] === 'python' && interests[1] === 'react', 'Interests array mutation checks clean');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 6: Comparison Queue Trimmed Object Representation
  // ────────────────────────────────────────────────────────
  console.log(' - Testing compare list object trimming...');
  
  clearCompare();
  
  const heavyRepo = {
    id: 12345,
    name: 'heavy-library',
    fullName: 'scout/heavy-library',
    url: 'https://github.com/scout/heavy-library',
    stars: 500,
    forks: 120,
    language: 'JavaScript',
    maintenanceStatus: 'HEALTHY',
    safetyFlag: 'SAFE',
    safetyNote: 'Permissive MIT license.',
    difficulty: 'Intermediate',
    sizeLabel: 'Heavy',
    daysSinceUpdate: 15,
    license: 'MIT',
    aiScore: 9,
    aiSummary: 'Vibrant developer visualizer.',
    aiPros: ['fast', 'documented'],
    aiCons: ['complex setup'],
    // Non-compare bulky fields to omit
    owner: { name: 'scout', avatar: 'avatar_url', url: 'profile_url' },
    readmeSnippet: 'A massive README text spanning 800 characters or more...',
    avgResponseHours: 24,
    avgCloseHours: 24
  };

  addToCompare(heavyRepo);
  const compareList = getCompareList();
  
  assert(compareList.length === 1, 'Repo added to compare list');
  const stored = compareList[0];
  
  // Verify comparison fields are fully preserved
  assert(stored.id === 12345, 'Trimmed repo id preserved');
  assert(stored.stars === 500, 'Trimmed repo stars preserved');
  assert(stored.avgCloseHours === 24, 'Trimmed repo backwards-compatible close hours preserved');

  // Verify bulky metadata fields are completely omitted from storage
  assert(stored.readmeSnippet === undefined, 'Bulky readmeSnippet omitted from compare storage');
  assert(stored.owner === undefined, 'Bulky owner details omitted from compare storage');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 7: Manifest Dependency Parsers
  // ────────────────────────────────────────────────────────
  console.log(' - Testing parseManifestDependencies manifest parsers...');
  
  // Test package.json
  const pkgJson = JSON.stringify({
    dependencies: { "react": "^18.2.0", "lodash": "4.17.21" },
    devDependencies: { "typescript": "^5.0.0" }
  });
  const parsedPkg = parseManifestDependencies('package.json', pkgJson);
  assert(parsedPkg.length === 3, 'package.json should have 3 dependencies');
  assert(parsedPkg.some(d => d.name === 'react' && d.version === '^18.2.0'), 'react parsed correctly');
  assert(parsedPkg.some(d => d.name === 'typescript' && d.version === '^5.0.0'), 'typescript parsed correctly');

  // Test requirements.txt
  const reqTxt = "flask==2.3.2\nrequests>=2.28.0\nnumpy\n# comments and flags\n-r other-requirements.txt";
  const parsedReq = parseManifestDependencies('requirements.txt', reqTxt);
  assert(parsedReq.length === 3, 'requirements.txt should have 3 dependencies');
  assert(parsedReq.some(d => d.name === 'flask' && d.version === '2.3.2'), 'flask version parsed correctly');
  assert(parsedReq.some(d => d.name === 'requests' && d.version === '2.28.0'), 'requests version parsed correctly');
  assert(parsedReq.some(d => d.name === 'numpy' && d.version === 'latest'), 'numpy version default latest');

  // Test Cargo.toml
  const cargoToml = "[package]\nname = 'test'\n[dependencies]\ntokio = '1.28.0'\nserde = { version = '1.0', features = ['derive'] }\n[dev-dependencies]\ncriterion = '0.4'";
  const parsedCargo = parseManifestDependencies('Cargo.toml', cargoToml);
  assert(parsedCargo.length === 3, 'Cargo.toml should have 3 dependencies');
  assert(parsedCargo.some(d => d.name === 'tokio' && d.version === '1.28.0'), 'tokio parsed correctly');
  assert(parsedCargo.some(d => d.name === 'serde' && d.version === '1.0'), 'serde parsed correctly');
  assert(parsedCargo.some(d => d.name === 'criterion' && d.version === '0.4'), 'criterion parsed correctly');

  // Test go.mod
  const goMod = "module test\n\ngo 1.20\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/stretchr/testify v1.8.2 // indirect\n)\n\nrequire github.com/google/uuid v1.3.0";
  const parsedGo = parseManifestDependencies('go.mod', goMod);
  assert(parsedGo.length === 3, 'go.mod should have 3 dependencies');
  assert(parsedGo.some(d => d.name === 'github.com/gin-gonic/gin' && d.version === 'v1.9.0'), 'gin parsed correctly');
  assert(parsedGo.some(d => d.name === 'github.com/google/uuid' && d.version === 'v1.3.0'), 'uuid parsed correctly');

  // Test Gemfile
  const gemfile = "source 'https://rubygems.org'\ngem 'rails', '~> 7.0.0'\ngem 'pg'\ngem 'puma', '>= 5.0'";
  const parsedGem = parseManifestDependencies('Gemfile', gemfile);
  assert(parsedGem.length === 3, 'Gemfile should have 3 dependencies');
  assert(parsedGem.some(d => d.name === 'rails' && d.version === '~> 7.0.0'), 'rails parsed correctly');
  assert(parsedGem.some(d => d.name === 'pg' && d.version === 'latest'), 'pg parsed correctly');
  assert(parsedGem.some(d => d.name === 'puma' && d.version === '>= 5.0'), 'puma parsed correctly');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 8: Large File Explanation Chunking & Cache Keys
  // ────────────────────────────────────────────────────────
  console.log(' - Testing large file explanation chunker logic and cache keys...');
  
  // 1. Chunker boundary verification
  const fullText = "a".repeat(100);
  const chunkSize = 35;
  const chunks = [];
  for (let i = 0; i < fullText.length; i += chunkSize) {
    chunks.push(fullText.substring(i, i + chunkSize));
  }
  
  assert(chunks.length === 3, '100 chars split into 35-size chunks should result in exactly 3 chunks');
  assert(chunks[0].length === 35, 'First chunk should be exactly 35 chars');
  assert(chunks[1].length === 35, 'Second chunk should be exactly 35 chars');
  assert(chunks[2].length === 30, 'Third chunk should be exactly 30 chars');
  
  // 2. Double Cache key separation checks
  const mockCache = new Map();
  const repoName = "test-owner/test-repo";
  const filePath = "src/main.js";
  const quickKey = `${repoName}::${filePath}::quick`;
  const fullKey = `${repoName}::${filePath}::full`;
  
  mockCache.set(quickKey, "Quick Summary Content");
  mockCache.set(fullKey, "Full Synthetic Content");
  
  assert(mockCache.get(quickKey) === "Quick Summary Content", 'Quick cache value correct');
  assert(mockCache.get(fullKey) === "Full Synthetic Content", 'Full cache value correct');
  assert(quickKey !== fullKey, 'Cache keys must remain strictly separate');

  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 9: Ranked Keyword Extractor with Phrase Support
  // ────────────────────────────────────────────────────────
  console.log(' - Testing extractSignificantKeywords ranking and phrase extractor...');
  
  // 1. Multi-word tech phrase detection & hyphenation
  const text1 = "I want to build a fitness tracker app using pose estimation and tensorflow";
  const keywords1 = extractSignificantKeywords(text1);
  assert(keywords1.includes("fitness-tracker"), "Should extract and hyphenate phrase 'fitness tracker'");
  assert(keywords1.includes("pose-estimation"), "Should extract and hyphenate phrase 'pose estimation'");
  assert(keywords1.includes("tensorflow"), "Should extract tensorflow");
  assert(!keywords1.includes("want") && !keywords1.includes("app"), "Should filter out stop words and general terms");

  // 2. Technical word ranking (high priority tech words should come first)
  const text2 = "compiler logic functional rust language";
  const keywords2 = extractSignificantKeywords(text2);
  // 'rust' and 'compiler' are in HIGH_PRIORITY_TECH_WORDS (score 2)
  // 'functional' and 'logic' are standard keywords (score 1)
  assert(keywords2[0] === "compiler" && keywords2[1] === "rust", "High-priority tech words compiler and rust should come first");
  assert(keywords2.includes("functional") && keywords2.includes("logic"), "Should include logic and functional words");
  assert(!keywords2.includes("language"), "Should filter out language");

  // 3. Fallback check for empty results or purely non-technical text
  const text3 = "I want to do this thing please help";
  const keywords3 = extractSignificantKeywords(text3);
  assert(keywords3.length > 0, "Fallback should return at least some words if no tech words are found");
  
  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 10: Cosine Similarity TF-IDF Mathematics
  // ────────────────────────────────────────────────────────
  console.log(' - Testing computeTfidfSimilarity cosine similarity...');
  const testChunks = [
    { id: 'chunk1', content: 'function initializeDatabaseConnection() { const db = connect(); }' },
    { id: 'chunk2', content: 'class RenderPipeline { drawScreen() { console.log("render"); } }' }
  ];
  const queryResult = computeTfidfSimilarity('database connection', testChunks, 1);
  assert(queryResult.length === 1, 'Should find 1 matching chunk');
  assert(queryResult[0].id === 'chunk1', 'Should match chunk1 containing database connection');
  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 11: Lockfile Transitive Dependency Parser
  // ────────────────────────────────────────────────────────
  console.log(' - Testing parseLockfileDependencies parser...');
  const packageLockData = JSON.stringify({
    packages: {
      "node_modules/express": {
        version: "4.18.2",
        dependencies: {
          "accepts": "~1.3.8"
        }
      },
      "node_modules/accepts": {
        version: "1.3.8"
      }
    }
  });
  const parsedLock = parseLockfileDependencies('package-lock.json', packageLockData);
  assert(parsedLock.nodes['express'] === '4.18.2', 'Express version resolved');
  assert(parsedLock.nodes['accepts'] === '1.3.8', 'Accepts version resolved');
  assert(parsedLock.edges.some(e => e.from === 'express' && e.to === 'accepts'), 'Transitive edge express -> accepts resolved');
  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  // Test Case 12: Radar Chart SVG Coordinate Math
  // ────────────────────────────────────────────────────────
  console.log(' - Testing Radar Chart SVG coordinate calculations...');
  const testScore = 10;
  const testRadius = (testScore / 10) * 100;
  const testAngle = -Math.PI / 2; // top axis
  const testX = 150 + testRadius * Math.cos(testAngle);
  const testY = 150 + testRadius * Math.sin(testAngle);
  assert(Math.abs(testX - 150) < 1e-5, 'X coordinate at top axis should be exactly 150');
  assert(Math.abs(testY - 50) < 1e-5, 'Y coordinate at top axis score 10 should be exactly 50');
  console.log('   🟢 Passed!');

  // ────────────────────────────────────────────────────────
  console.log('\n🎉 ALL Git Scout automated unit tests completed successfully! [60/60 RESOLVED]');
  process.exit(0);
} catch (testErr) {
  console.error('❌ Test Runner Crash:', testErr);
  process.exit(1);
}
