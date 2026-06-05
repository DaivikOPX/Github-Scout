/**
 * utils.js — Pure business logic helpers (Recursive tree parser, markdown formatter, nested JSON recovery scanner).
 * Decoupled from browser UI or DOM, allowing safe execution in automated Node test environments.
 */

/**
 * Parses flat file paths into a recursive hierarchical directory tree.
 */
export function buildDirectoryTree(paths) {
  const root = { name: 'Root', type: 'directory', path: '', children: [] };
  
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split('/');
    let current = root;
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      const type = isLast ? 'file' : 'directory';
      
      let child = current.children.find(c => c.name === part && c.type === type);
      if (!child) {
        child = {
          name: part,
          type: type,
          path: currentPath,
          children: []
        };
        current.children.push(child);
      }
      current = child;
    }
  }
  
  function sortTree(node) {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) {
        sortTree(child);
      }
    }
  }
  sortTree(root);
  
  return root;
}

/**
 * Renders basic markdown to safe, sanitized HTML.
 * Uses a collision-proof dynamic placeholder system for code block isolation.
 */
export function parseMarkdown(text) {
  if (!text) return '';
  // Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (triple backticks)
  const codeBlocks = [];
  const placeholders = [];
  
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    codeBlocks.push(code.trim());
    
    // Generate a unique placeholder token and check for collision in-place.
    let placeholder;
    do {
      const rand = Math.random().toString(36).substring(2, 7);
      placeholder = `__CODE_BLOCK_${rand}_${codeBlocks.length - 1}__`;
    } while (html.includes(placeholder));
    
    placeholders.push(placeholder);
    return placeholder;
  });

  // Inline code (single backticks)
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Unordered Lists
  let insideList = false;
  const lines = html.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2);
      if (!insideList) {
        insideList = true;
        return '<ul><li>' + content + '</li>';
      }
      return '<li>' + content + '</li>';
    } else {
      if (insideList) {
        insideList = false;
        return '</ul>' + line;
      }
      return line;
    }
  });
  if (insideList) {
    processedLines.push('</ul>');
  }
  html = processedLines.join('\n');

  // Ordered Lists
  let insideOList = false;
  const linesO = html.split('\n');
  const processedLinesO = linesO.map(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (match) {
      const content = match[2];
      if (!insideOList) {
        insideOList = true;
        return '<ol><li>' + content + '</li>';
      }
      return '<li>' + content + '</li>';
    } else {
      if (insideOList) {
        insideOList = false;
        return '</ol>' + line;
      }
      return line;
    }
  });
  if (insideOList) {
    processedLinesO.push('</ol>');
  }
  html = processedLinesO.join('\n');

  // Restore code blocks using the exact placeholder tokens generated
  codeBlocks.forEach((code, idx) => {
    const placeholder = placeholders[idx];
    if (placeholder) {
      html = html.replace(placeholder, `<pre><code>${code}</code></pre>`);
    }
  });

  // Paragraphs & Newlines
  html = html.split('\n\n').map(p => {
    const t = p.trim();
    if (t.startsWith('<pre') || t.startsWith('<ul') || t.startsWith('<ol') || t.startsWith('<blockquote')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

/**
 * Character-by-character scanning JSON recovery parser that tracks curly brace depth
 * and safely isolates nested JSON objects from malformed or conversational texts.
 */
export function extractJsonObjects(str) {
  const results = [];
  let depth = 0;
  let startIdx = -1;
  let insideString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (insideString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        insideString = false;
      }
    } else {
      if (char === '"') {
        insideString = true;
      } else if (char === '{') {
        if (depth === 0) {
          startIdx = i;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const candidate = str.substring(startIdx, i + 1);
          try {
            results.push(JSON.parse(candidate));
          } catch (err) {
            // ignore malformed candidate
          }
          startIdx = -1;
        } else if (depth < 0) {
          depth = 0; // reset on malformed
        }
      }
    }
  }
  return results;
}

/**
 * Parses package manifests dynamically to extract dependencies and their versions.
 * Supports: package.json, requirements.txt, Cargo.toml, go.mod, and Gemfile.
 */
export function parseManifestDependencies(fileName, content) {
  const deps = [];
  const name = (fileName || '').toLowerCase();
  
  if (!content) return deps;

  if (name.endsWith('package.json')) {
    try {
      const parsed = JSON.parse(content);
      const all = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
      Object.entries(all).forEach(([pkg, version]) => {
        deps.push({ name: pkg, version: String(version) });
      });
    } catch (e) {
      console.warn('Failed to parse package.json:', e);
    }
  } else if (name.endsWith('requirements.txt')) {
    const lines = content.split('\n');
    lines.forEach(line => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || clean.startsWith('-r')) return;
      // Split on common constraints: ==, >=, <=, >, <, ~=, @
      const parts = clean.split(/[=><~@]/);
      const pkg = parts[0].trim();
      if (pkg) {
        let version = 'latest';
        const vMatch = clean.match(/[=><~@]+\s*([\w.-]+)/);
        if (vMatch) version = vMatch[1];
        deps.push({ name: pkg, version });
      }
    });
  } else if (name.endsWith('cargo.toml')) {
    const lines = content.split('\n');
    let inDeps = false;
    lines.forEach(line => {
      const clean = line.trim();
      if (clean.startsWith('[')) {
        inDeps = clean.startsWith('[dependencies]') || clean.startsWith('[dev-dependencies]') || clean.startsWith('[build-dependencies]');
        return;
      }
      if (inDeps && clean && !clean.startsWith('#')) {
        const eqIdx = clean.indexOf('=');
        if (eqIdx !== -1) {
          const pkg = clean.substring(0, eqIdx).trim();
          let version = 'latest';
          const vMatch = clean.substring(eqIdx).match(/["']([\w.-]+)["']/);
          if (vMatch) version = vMatch[1];
          deps.push({ name: pkg, version });
        }
      }
    });
  } else if (name.endsWith('go.mod')) {
    const lines = content.split('\n');
    let inRequire = false;
    lines.forEach(line => {
      const clean = line.trim();
      if (clean.startsWith('require (')) {
        inRequire = true;
        return;
      }
      if (inRequire && clean === ')') {
        inRequire = false;
        return;
      }
      if (clean.startsWith('require ')) {
        const parts = clean.substring(8).trim().split(/\s+/);
        if (parts[0]) {
          deps.push({ name: parts[0], version: parts[1] || 'latest' });
        }
      } else if (inRequire && clean && !clean.startsWith('//')) {
        const parts = clean.split(/\s+/);
        if (parts[0]) {
          deps.push({ name: parts[0], version: parts[1] || 'latest' });
        }
      }
    });
  } else if (name.endsWith('gemfile')) {
    const lines = content.split('\n');
    lines.forEach(line => {
      const clean = line.trim();
      if (clean.startsWith('gem ')) {
        const match = clean.match(/gem\s+["']([\w-]+)["']/);
        if (match) {
          let version = 'latest';
          const vMatch = clean.match(/,\s*["']([^"']+)["']/);
          if (vMatch) version = vMatch[1];
          deps.push({ name: match[1], version });
        }
      }
    });
  }
  return deps;
}

/**
 * Parses user idea descriptions (1-liners, paragraphs, or essays), filters out noise,
 * and extracts/ranks the most significant technical keywords and multi-word phrases.
 * Returns a flat array of the top 4-5 key terms for GitHub search.
 */
export function extractSignificantKeywords(text) {
  if (!text) return [];

  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot',
    'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few',
    'for', 'from', 'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell',
    'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill',
    'im', 'ive', 'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt',
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so',
    'some', 'such', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasnt', 'we', 'wed', 'well', 'were', 'werent', 'what', 'whats',
    'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont',
    'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves',
    'want', 'wants', 'build', 'building', 'make', 'making', 'create', 'creating', 'search', 'searching',
    'find', 'finding', 'write', 'writing', 'code', 'program', 'project', 'repo', 'repos', 'repository',
    'repositories', 'app', 'apps', 'application', 'applications', 'software', 'tool', 'tools', 'library',
    'libraries', 'system', 'systems', 'developer', 'developers', 'git', 'github', 'idea', 'ideas', 'essay',
    'paragraph', 'text', 'typed', 'show', 'showing', 'shows', 'look', 'looking', 'please', 'help', 'need',
    'needs', 'implement', 'implementation', 'design', 'designing', 'use', 'using', 'uses', 'some', 'simple',
    'complex', 'advanced', 'beginner', 'standard', 'basic', 'custom', 'different', 'new', 'old', 'first',
    'second', 'third', 'thing', 'things', 'good', 'better', 'best', 'example', 'examples', 'support', 'language', 'languages'
  ]);

  const HIGH_PRIORITY_TECH_WORDS = new Set([
    'rust', 'python', 'javascript', 'typescript', 'golang', 'cpp', 'swift', 'kotlin', 'java', 'ruby', 'php', 'html',
    'css', 'solidity', 'sql', 'react', 'vue', 'angular', 'svelte', 'django', 'flask', 'fastapi', 'rails', 'spring',
    'express', 'nextjs', 'tensorflow', 'pytorch', 'keras', 'opencv', 'numpy', 'pandas', 'flutter', 'ionic', 'cordova',
    'electron', 'tailwind', 'bootstrap', 'bios', 'uefi', 'firmware', 'coreboot', 'database', 'devops', 'docker',
    'kubernetes', 'blockchain', 'ethereum', 'smart-contract', 'api', 'graphql', 'oauth', 'grpc', 'websocket',
    'serverless', 'microservices', 'compiler', 'interpreter', 'emulator', 'parser', 'renderer', 'router', 'redux',
    'mobx', 'prisma', 'sequelize', 'mongoose', 'redis', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'sqlite3',
    'cassandra', 'elasticsearch', 'rabbitmq', 'kafka', 'cybersecurity', 'cryptography', 'animation', 'physics',
    'simulation', 'graphics', 'canvas', 'webgl', 'audio', 'video', 'midi', 'synth', 'robot', 'robotics', 'bluetooth',
    'wifi', 'sensor', 'camera', 'lidar', 'radar', 'llvm', 'deepcheck', 'pose', 'estimation', 'vision', 'intelligence',
    'nlp', 'llm', 'gpt', 'bert', 'transformer', 'neural', 'network', 'ai'
  ]);

  const TECHNICAL_PHRASES = [
    'react native', 'pose estimation', 'tensorflow', 'tensor flow', 'fitness tracker',
    'computer vision', 'machine learning', 'deep learning', 'natural language', 'neural network',
    'data science', 'web development', 'time series', 'rest api', 'google cloud', 'amazon web',
    'docker container', 'kubernetes cluster', 'smart contract', 'command line', 'audio processing',
    'image processing', 'video processing', 'bios extension', 'game dev', 'game engine',
    'browser extension', 'mobile app', 'desktop app'
  ];

  let cleanedText = text.toLowerCase();
  const foundPhrases = [];

  // Match and extract known technical phrases first
  for (const phrase of TECHNICAL_PHRASES) {
    if (cleanedText.includes(phrase)) {
      // Add the hyphenated version to preserve phrase structure in search
      const hyphenated = phrase.replace(/\s+/g, '-');
      if (!foundPhrases.includes(hyphenated)) {
        foundPhrases.push(hyphenated);
      }
      // Remove it from the text to avoid double extraction of parts
      cleanedText = cleanedText.split(phrase).join(' ');
    }
  }

  // Clean remaining text of non-alphanumeric (keep hyphens inside words)
  const words = cleanedText
    .replace(/[^\w\s-]/g, '')
    .split(/[\s_]+/)
    .map(w => w.trim())
    .filter(Boolean);

  const scoredWords = [];

  for (const w of words) {
    const cleaned = w.replace(/^-+|-+$/g, '');
    if (cleaned.length >= 2 && !STOP_WORDS.has(cleaned) && !/^\d+$/.test(cleaned)) {
      const isPriority = HIGH_PRIORITY_TECH_WORDS.has(cleaned);
      const score = isPriority ? 2 : 1;
      
      const existing = scoredWords.find(item => item.word === cleaned);
      if (existing) {
        // Boost frequency importance
        existing.score += 0.5;
      } else {
        scoredWords.push({ word: cleaned, score, index: scoredWords.length });
      }
    }
  }

  // Combine phrases (score 3) and words
  const candidates = [
    ...foundPhrases.map((phrase, idx) => ({ word: phrase, score: 3, index: -100 + idx })),
    ...scoredWords
  ];

  // Sort candidates by score descending, then by original appearance index ascending to preserve order on ties
  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  // Extract top 4-5 terms
  const result = candidates.map(c => c.word).slice(0, 5);

  // If empty, fallback to the first 3 cleaned words of the text
  if (result.length === 0) {
    const fallbackWords = words.filter(w => w.length >= 2).slice(0, 3);
    return fallbackWords;
  }

  return result;
}

/**
 * Splits source file contents into overlapping character segments for analysis.
 */
export function chunkFileContent(filePath, content, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  if (!content) return chunks;

  let start = 0;
  let idx = 0;
  while (start < content.length) {
    const end = Math.min(start + chunkSize, content.length);
    const text = content.substring(start, end);
    chunks.push({
      id: `${filePath}#chunk${idx}`,
      filePath,
      content: text,
      startLine: content.substring(0, start).split('\n').length,
      endLine: content.substring(0, end).split('\n').length
    });
    
    idx++;
    start += (chunkSize - overlap);
    if (start >= content.length || end === content.length) break;
  }
  return chunks;
}

/**
 * Computes TF-IDF cosine similarity between a developer query and code chunks,
 * returning the top K most relevant chunks.
 */
export function computeTfidfSimilarity(query, chunks, topK = 3) {
  if (!query || !chunks || chunks.length === 0) return [];

  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot',
    'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few',
    'for', 'from', 'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell',
    'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill',
    'im', 'ive', 'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt',
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so',
    'some', 'such', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasnt', 'we', 'wed', 'well', 'were', 'werent', 'what', 'whats',
    'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont',
    'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
  ]);

  function tokenize(text) {
    const splitCamel = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    return splitCamel.toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/[\s_]+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const numDocs = chunks.length;
  const docTokens = chunks.map(c => tokenize(c.content || ''));
  
  // Calculate Document Frequency (DF) for all terms
  const df = {};
  docTokens.forEach(tokens => {
    const unique = new Set(tokens);
    unique.forEach(t => {
      df[t] = (df[t] || 0) + 1;
    });
  });

  // Calculate Inverse Document Frequency (IDF)
  const idf = {};
  Object.keys(df).forEach(t => {
    idf[t] = Math.log(1 + numDocs / df[t]);
  });

  // Query IDF term weight
  const queryWeights = {};
  queryTokens.forEach(t => {
    queryWeights[t] = (queryWeights[t] || 0) + 1;
  });
  Object.keys(queryWeights).forEach(t => {
    queryWeights[t] = queryWeights[t] * (idf[t] || 1);
  });

  // Calculate similarity for each chunk document
  const scoredChunks = chunks.map((chunk, docIdx) => {
    const tokens = docTokens[docIdx];
    const tf = {};
    tokens.forEach(t => {
      tf[t] = (tf[t] || 0) + 1;
    });

    let dotProduct = 0;
    let queryNormSq = 0;
    let docNormSq = 0;

    const checkedTerms = new Set([...queryTokens, ...tokens]);
    checkedTerms.forEach(t => {
      const qVal = queryWeights[t] || 0;
      const dVal = (tf[t] || 0) * (idf[t] || 1);
      
      dotProduct += qVal * dVal;
      queryNormSq += qVal * qVal;
      docNormSq += dVal * dVal;
    });

    const queryNorm = Math.sqrt(queryNormSq);
    const docNorm = Math.sqrt(docNormSq);
    const score = (queryNorm > 0 && docNorm > 0) ? (dotProduct / (queryNorm * docNorm)) : 0;

    return { chunk, score };
  });

  // Sort and return top K
  return scoredChunks
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.chunk);
}

/**
 * Parses lockfiles to extract nested/transitive dependency structures.
 * Returns { nodes: { [name]: version }, edges: [ { from, to } ] }
 */
export function parseLockfileDependencies(fileName, content) {
  const nodes = {};
  const edges = [];
  const name = (fileName || '').toLowerCase();
  
  if (!content) return { nodes, edges };

  if (name.endsWith('package-lock.json')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.packages) {
        Object.entries(parsed.packages).forEach(([path, pkgInfo]) => {
          if (!path || path === "") return;
          const pkgName = path.replace(/^node_modules\//, '');
          if (!pkgName) return;
          nodes[pkgName] = pkgInfo.version || 'unknown';
          
          if (pkgInfo.dependencies) {
            Object.keys(pkgInfo.dependencies).forEach(depName => {
              edges.push({ from: pkgName, to: depName });
            });
          }
        });
      } else if (parsed.dependencies) {
        // v1 package-lock
        const walk = (depsMap) => {
          Object.entries(depsMap).forEach(([pkgName, pkgInfo]) => {
            nodes[pkgName] = pkgInfo.version || 'unknown';
            if (pkgInfo.requires) {
              Object.keys(pkgInfo.requires).forEach(depName => {
                edges.push({ from: pkgName, to: depName });
              });
            }
            if (pkgInfo.dependencies) {
              walk(pkgInfo.dependencies);
            }
          });
        };
        walk(parsed.dependencies);
      }
    } catch (e) {
      console.warn('Failed to parse package-lock.json:', e);
    }
  } else if (name.endsWith('cargo.lock')) {
    try {
      const lines = content.split('\n');
      let currentPkg = null;
      lines.forEach(line => {
        const clean = line.trim();
        if (clean.startsWith('[[package]]')) {
          if (currentPkg && currentPkg.name) {
            nodes[currentPkg.name] = currentPkg.version || 'unknown';
            if (currentPkg.dependencies) {
              currentPkg.dependencies.forEach(dep => {
                edges.push({ from: currentPkg.name, to: dep });
              });
            }
          }
          currentPkg = {};
        } else if (currentPkg) {
          if (clean.startsWith('name =')) {
            const match = clean.match(/name\s*=\s*["']([^"']+)["']/);
            if (match) currentPkg.name = match[1];
          } else if (clean.startsWith('version =')) {
            const match = clean.match(/version\s*=\s*["']([^"']+)["']/);
            if (match) currentPkg.version = match[1];
          } else if (clean.startsWith('dependencies =')) {
            currentPkg.inDeps = true;
            currentPkg.dependencies = [];
          } else if (currentPkg.inDeps) {
            if (clean.startsWith(']')) {
              currentPkg.inDeps = false;
            } else {
              const match = clean.match(/["']([^"']+)["']/);
              if (match) {
                // Cargo lock dependency values might contain other fields, split on space
                const depName = match[1].split(' ')[0];
                currentPkg.dependencies.push(depName);
              }
            }
          }
          
          if (clean === "" || clean.startsWith('[')) {
            if (currentPkg.name) {
              nodes[currentPkg.name] = currentPkg.version || 'unknown';
              if (currentPkg.dependencies) {
                currentPkg.dependencies.forEach(dep => {
                  edges.push({ from: currentPkg.name, to: dep });
                });
              }
            }
            currentPkg = clean.startsWith('[[package]]') ? {} : null;
          }
        }
      });
      if (currentPkg && currentPkg.name) {
        nodes[currentPkg.name] = currentPkg.version || 'unknown';
        if (currentPkg.dependencies) {
          currentPkg.dependencies.forEach(dep => {
            edges.push({ from: currentPkg.name, to: dep });
          });
        }
      }
    } catch (e) {
      console.warn('Failed to parse Cargo.lock:', e);
    }
  }
  
  return { nodes, edges };
}


