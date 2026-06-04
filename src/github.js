/**
 * github.js — Enhanced GitHub Search API integration
 * Fetches repos, issues response times, README content, and deeper metadata.
 */

const GITHUB_API = 'https://api.github.com';

function buildSearchQuery(interests, language = '') {
  const q = interests.map(i => i.trim()).filter(Boolean)
    .map(i => (i.includes(' ') ? `"${i}"` : i)).join(' ');
  let query = q + ' stars:>10';
  if (language) query += ` language:${language}`;
  return query;
}

function getHeaders(token) {
  const h = { 'Accept': 'application/vnd.github.v3+json' };
  if (token) h['Authorization'] = `token ${token}`;
  return h;
}

async function fetchWithBackoff(url, options, maxRetries = 3) {
  let delayMs = 1000;
  for (let i = 0; i < maxRetries; i++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (i === maxRetries - 1) {
        throw err;
      }
      console.warn(`Fetch network error: ${err.message}. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${maxRetries})`);
      await delay(delayMs);
      delayMs *= 2;
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      let isActualRateLimit = true;
      try {
        const clone = res.clone();
        const body = await clone.json();
        if (body && body.message) {
          const msg = body.message.toLowerCase();
          if (msg.includes('rate limit') || msg.includes('secondary rate') || msg.includes('too many requests')) {
            isActualRateLimit = true;
          } else if (msg.includes('large') || msg.includes('truncated') || msg.includes('too long') || msg.includes('too many')) {
            isActualRateLimit = false;
          }
        }
      } catch {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining !== null && Number(remaining) > 0) {
          isActualRateLimit = false;
        }
      }

      if (!isActualRateLimit) {
        return res;
      }

      if (i === maxRetries - 1) {
        throw new Error('GitHub API rate limit exceeded (403). Add a GitHub Personal Access Token in Settings to bypass this limit.');
      }
      console.warn(`GitHub API Rate Limit hit (${res.status}). Retrying in ${delayMs}ms... (Attempt ${i + 1}/${maxRetries})`);
      await delay(delayMs);
      delayMs *= 2;
      continue;
    }
    return res;
  }
  // Fallback
  return fetch(url, options);
}

/**
 * Main search: combines keyword + topic search, deduplicates.
 */
export async function searchRepos(interests, options = {}) {
  const { token = '', language = '', page = 0, pages = 2, includeTopicSearch = true } = options;
  const headers = getHeaders(token);
  
  // Direct Link Scouting Check
  if (interests.length === 1) {
    const ghRegex = /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s]+)/i;
    const match = interests[0].match(ghRegex);
    if (match) {
      const fullName = `${match[1]}/${match[2].replace(/\.git$/, '').replace(/\?.*$/, '').replace(/#.*$/, '')}`;
      const res = await fetchWithBackoff(`${GITHUB_API}/repos/${fullName}`, { headers });
      if (!res.ok) {
        if (res.status === 404) throw new Error(`Repository not found: ${fullName}`);
        throw new Error(`GitHub error: ${res.status}`);
      }
      const data = await res.json();
      return [normalize(data)];
    }
  }

  const seen = new Set();
  const all = [];

  // Keyword search
  const query = buildSearchQuery(interests, language);
  const startPage = page > 0 ? page : 1;
  const endPage = page > 0 ? page : pages;

  for (let p = startPage; p <= endPage; p++) {
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30&page=${p}`;
    const res = await fetchWithBackoff(url, { headers });
    if (!res.ok) {
      if (res.status === 403) throw new Error('GitHub Search Rate Limit reached! Add a GitHub Personal Access Token in Settings to bypass this.');
      throw new Error(`GitHub error: ${res.status}`);
    }
    const data = await res.json();
    for (const r of data.items || []) {
      if (!seen.has(r.id)) { seen.add(r.id); all.push(normalize(r)); }
    }
    if ((data.items || []).length < 30) break;
    await delay(350);
  }

  // Topic search (top 4 interests)
  if (includeTopicSearch) {
    for (const interest of interests.slice(0, 4)) {
      const tq = `topic:${interest.replace(/\s+/g, '-')} stars:>10`;
      try {
        const res = await fetchWithBackoff(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(tq)}&sort=stars&order=desc&per_page=10`, { headers });
        if (res.ok) {
          const data = await res.json();
          for (const r of data.items || []) {
            if (!seen.has(r.id)) { seen.add(r.id); all.push(normalize(r)); }
          }
        }
      } catch { /* skip */ }
      await delay(400);
    }
  }

  return all;
}

/**
 * Enrich repos with extra data: issue response time, README snippet.
 * Called after initial search with a subset of top repos.
 */
export async function enrichRepos(repos, token = '', onProgress = () => {}) {
  const headers = getHeaders(token);
  const BATCH_SIZE = 5;
  const enriched = [];

  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (r) => {
      const repo = { ...r };
      
      // Sample issues for avg time to close
      try {
        const issuesUrl = `${GITHUB_API}/repos/${repo.fullName}/issues?state=closed&sort=updated&per_page=5`;
        const res = await fetchWithBackoff(issuesUrl, { headers });
        if (res.ok) {
          const issues = await res.json();
          const responseTimes = issues
            .filter(issue => !issue.pull_request && issue.created_at && issue.closed_at)
            .map(issue => (new Date(issue.closed_at) - new Date(issue.created_at)) / 3600000);
          repo.avgCloseHours = responseTimes.length
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : null;
        }
      } catch { repo.avgCloseHours = null; }

      // Readme snippet
      try {
        const readmeUrl = `${GITHUB_API}/repos/${repo.fullName}/readme`;
        const res = await fetchWithBackoff(readmeUrl, { headers });
        if (res.ok) {
          const data = await res.json();
          // Safe base64 decode with UTF-8 support
          const b64 = data.content.replace(/\s/g, '');
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const content = new TextDecoder().decode(bytes);
          repo.readmeSnippet = content.substring(0, 800);
        }
      } catch (err) { 
        console.warn('README decode failed', repo.fullName, err);
        repo.readmeSnippet = ''; 
      }

      return repo;
    }));

    enriched.push(...results);
    onProgress(enriched.length, repos.length);
    if (i + BATCH_SIZE < repos.length) await delay(300);
  }

  return enriched;
}

function normalize(r) {
  const daysSinceUpdate = r.pushed_at
    ? Math.floor((Date.now() - new Date(r.pushed_at).getTime()) / 86400000)
    : 9999;
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    description: r.description || 'No description.',
    language: r.language || 'Unknown',
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    watchers: r.watchers_count,
    size: r.size, // KB
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at || null,
    topics: r.topics || [],
    license: r.license?.spdx_id || 'No license',
    owner: { name: r.owner.login, avatar: r.owner.avatar_url, url: r.owner.html_url },
    daysSinceUpdate,
    isRecentlyActive: daysSinceUpdate < 90,
    starToForkRatio: r.forks_count > 0 ? (r.stargazers_count / r.forks_count).toFixed(1) : 'N/A',
    sizeLabel: r.size < 1000 ? 'Lightweight' : r.size < 50000 ? 'Medium' : 'Heavy',
    defaultBranch: r.default_branch || 'main',
    avgCloseHours: null,
    readmeSnippet: '',
  };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function fetchRepoTree(fullName, token = '', defaultBranch = '', signal = null) {
  const headers = getHeaders(token);
  try {
    let branch = defaultBranch;
    if (!branch) {
      // 1. Get default branch
      const repoRes = await fetchWithBackoff(`${GITHUB_API}/repos/${fullName}`, { headers, signal });
      if (!repoRes.ok) throw new Error(`Failed to fetch repo details (${repoRes.status})`);
      const repoData = await repoRes.json();
      branch = repoData.default_branch || 'main';
    }

    // 2. Get tree recursive
    let treeUrl = `${GITHUB_API}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    let res = await fetchWithBackoff(treeUrl, { headers, signal });
    
    // Fallback if recursive is too large or fails
    if (!res.ok) {
      console.warn('Recursive tree failed, falling back to root tree...');
      treeUrl = `${GITHUB_API}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}`;
      res = await fetchWithBackoff(treeUrl, { headers, signal });
    }

    if (!res.ok) throw new Error(`GitHub Tree API failed: ${res.status}`);
    const treeData = await res.json();
    const isTruncated = !!treeData.truncated;
    if (treeData.truncated) {
      console.warn(`Git tree for ${fullName} was truncated by GitHub API`);
    }
    
    // Filter out node_modules, .git, dist, etc.
    const paths = (treeData.tree || [])
      .filter(t => t.type === 'blob' && !t.path.includes('node_modules') && !t.path.includes('.git/') && !t.path.includes('dist/') && !t.path.includes('package-lock.json'))
      .map(t => t.path);
      
    paths.isTruncated = isTruncated;
      
    // If we still have nothing, maybe try simple contents API as last resort
    if (!paths.length) {
      const contentRes = await fetchWithBackoff(`${GITHUB_API}/repos/${fullName}/contents`, { headers, signal });
      if (contentRes.ok) {
        const contents = await contentRes.json();
        return contents.filter(f => f.type === 'file').map(f => f.name);
      }
    }

    return paths;
  } catch (err) {
    // Let rate-limit errors propagate so the UI can show a targeted message
    if (err.message.includes('rate limit') || err.message.includes('403')) {
      throw err;
    }
    console.error('fetchRepoTree err:', err);
    return [];
  }
}

/**
 * Agent 1: The Inspector (Vibe Check)
 * Fetches recent issues to check repo health.
 */
export async function fetchRepoIssues(fullName, token = '', signal = null) {
  const headers = getHeaders(token);
  try {
    const res = await fetchWithBackoff(`${GITHUB_API}/repos/${fullName}/issues?state=all&per_page=10&sort=created&direction=desc`, { headers, signal });
    if (!res.ok) return [];
    const issues = await res.json();
    return issues.map(i => ({
      title: i.title,
      state: i.state,
      isBug: i.labels.some(l => l.name.toLowerCase().includes('bug')),
      comments: i.comments,
      createdAt: i.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Robust GitHub content fetcher for clicked files or package manifests.
 * Enforces a strict 40KB capacity limit, checks metadata, and handles path encoding.
 */
export async function fetchRepoFileContent(fullName, filePath, token = '', defaultBranch = '', signal = null, sizeLimit = 40 * 1024) {
  const headers = getHeaders(token);
  // Encodes file paths carefully (retaining / slashes but escaping individual parts)
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  
  let branch = defaultBranch;
  if (!branch) {
    try {
      const repoRes = await fetchWithBackoff(`${GITHUB_API}/repos/${fullName}`, { headers, signal });
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        branch = repoData.default_branch || 'main';
      } else {
        branch = 'main';
      }
    } catch {
      branch = 'main';
    }
  }

  const url = `${GITHUB_API}/repos/${fullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  
  try {
    const res = await fetchWithBackoff(url, { headers, signal });
    if (!res.ok) throw new Error(`Failed to fetch file metadata (${res.status})`);
    const metadata = await res.json();

    if (Array.isArray(metadata)) {
      throw new Error('Path is a directory, not a file.');
    }

    const size = metadata.size || 0;

    let contentText = '';
    let isTrimmed = false;

    if (metadata.content) {
      const b64 = metadata.content.replace(/\s/g, '');
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = new TextDecoder().decode(bytes);

      if (sizeLimit && decoded.length > sizeLimit) {
        contentText = decoded.substring(0, sizeLimit);
        isTrimmed = true;
      } else {
        contentText = decoded;
      }
    } else if (metadata.download_url) {
      // Do NOT send Authorization token to raw.githubusercontent.com because it causes CORS preflight block.
      const rawRes = await fetch(metadata.download_url, { signal });
      if (!rawRes.ok) throw new Error(`Failed to download raw file content (${rawRes.status})`);
      
      const rawText = await rawRes.text();
      if (sizeLimit && (size > sizeLimit || rawText.length > sizeLimit)) {
        contentText = rawText.substring(0, sizeLimit);
        isTrimmed = true;
      } else {
        contentText = rawText;
      }
    } else {
      throw new Error('No content available for this file.');
    }

    return {
      content: contentText,
      size,
      isTrimmed
    };
  } catch (err) {
    console.error(`fetchRepoFileContent failed for ${fullName}/${filePath}:`, err);
    throw err;
  }
}
