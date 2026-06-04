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
