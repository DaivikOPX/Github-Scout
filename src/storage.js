/**
 * storage.js — localStorage persistence for settings, bookmarks, history, profiles
 */

const K = {
  GROQ_KEY: 'rr_groq_key',
  OPENAI_KEY: 'rr_openai_key',
  ANTHROPIC_KEY: 'rr_anthropic_key',
  GEMINI_KEY: 'rr_gemini_key',
  GITHUB_TOKEN: 'rr_gh_token',
  HISTORY: 'rr_history',
  PROFILES: 'rr_profiles',
  BOOKMARKS: 'rr_bookmarks',
  AI_PROVIDER: 'rr_ai_provider',
  AI_MODEL: 'rr_ai_model',
  VIEWED: 'rr_viewed',
  GROQ_MODEL: 'rr_groq_model',
  OPENAI_MODEL: 'rr_openai_model',
  ANTHROPIC_MODEL: 'rr_anthropic_model',
  GEMINI_MODEL: 'rr_gemini_model',
  GROK_KEY: 'rr_grok_key',
  GROK_MODEL: 'rr_grok_model',
  HF_KEY: 'rr_hf_key',
  HF_MODEL: 'rr_hf_model',
  OPENROUTER_KEY: 'rr_openrouter_key',
  OPENROUTER_MODEL: 'rr_openrouter_model',
  CACHE: 'rr_search_cache',
  COMPARE_LIST: 'rr_compare_list',
  LIKES: 'rr_likes',
  CHAT_HISTORY: 'rr_chat_history',
};

const memoryStorage = {};
const sessionMemoryStorage = {};

/**
 * Robust try-catch wrapper for localStorage to catch QuotaExceededError or blocking.
 * Dispatches a decoupled event so UI components can display a friendly notice.
 */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.error(`localStorage setItem failed for key "${key}":`, e);
    memoryStorage[key] = value;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localstorage-failure', { detail: { key, error: e } }));
    }
  }
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key) || memoryStorage[key] || '';
  } catch {
    return memoryStorage[key] || '';
  }
}

/**
 * Robust try-catch wrapper for sessionStorage.
 */
function safeSetSessionItem(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (e) {
    console.error(`sessionStorage setItem failed for key "${key}":`, e);
    sessionMemoryStorage[key] = value;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('localstorage-failure', { detail: { key, error: e } }));
    }
  }
}

function safeGetSessionItem(key) {
  try {
    return sessionStorage.getItem(key) || sessionMemoryStorage[key] || '';
  } catch {
    return sessionMemoryStorage[key] || '';
  }
}

export const getGroqApiKey = () => safeGetItem(K.GROQ_KEY);
export const setGroqApiKey = (v) => safeSetItem(K.GROQ_KEY, v.trim());
export const getOpenAiKey = () => safeGetItem(K.OPENAI_KEY);
export const setOpenAiKey = (v) => safeSetItem(K.OPENAI_KEY, v.trim());
export const getAnthropicKey = () => safeGetItem(K.ANTHROPIC_KEY);
export const setAnthropicKey = (v) => safeSetItem(K.ANTHROPIC_KEY, v.trim());
export const getGeminiKey = () => safeGetItem(K.GEMINI_KEY);
export const setGeminiKey = (v) => safeSetItem(K.GEMINI_KEY, v.trim());
export const getGithubToken = () => safeGetItem(K.GITHUB_TOKEN);
export const setGithubToken = (v) => safeSetItem(K.GITHUB_TOKEN, v.trim());
export const getAiProvider = () => safeGetItem(K.AI_PROVIDER) || 'ollama';
export const setAiProvider = (v) => safeSetItem(K.AI_PROVIDER, v);
export const getAiModel = () => safeGetItem(K.AI_MODEL);
export const setAiModel = (v) => safeSetItem(K.AI_MODEL, v);
export const getGroqModel = () => safeGetItem(K.GROQ_MODEL);
export const setGroqModel = (v) => safeSetItem(K.GROQ_MODEL, v);
export const getOpenAiModel = () => safeGetItem(K.OPENAI_MODEL);
export const setOpenAiModel = (v) => safeSetItem(K.OPENAI_MODEL, v);
export const getAnthropicModel = () => safeGetItem(K.ANTHROPIC_MODEL);
export const setAnthropicModel = (v) => safeSetItem(K.ANTHROPIC_MODEL, v);
export const getGeminiModel = () => safeGetItem(K.GEMINI_MODEL);
export const setGeminiModel = (v) => safeSetItem(K.GEMINI_MODEL, v);
export const getGrokKey = () => safeGetItem(K.GROK_KEY);
export const setGrokKey = (v) => safeSetItem(K.GROK_KEY, v.trim());
export const getGrokModel = () => safeGetItem(K.GROK_MODEL);
export const setGrokModel = (v) => safeSetItem(K.GROK_MODEL, v);
export const getHfKey = () => safeGetItem(K.HF_KEY);
export const setHfKey = (v) => safeSetItem(K.HF_KEY, v.trim());
export const getHfModel = () => safeGetItem(K.HF_MODEL);
export const setHfModel = (v) => safeSetItem(K.HF_MODEL, v);
export const getOpenrouterKey = () => safeGetItem(K.OPENROUTER_KEY);
export const setOpenrouterKey = (v) => safeSetItem(K.OPENROUTER_KEY, v.trim());
export const getOpenrouterModel = () => safeGetItem(K.OPENROUTER_MODEL);
export const setOpenrouterModel = (v) => safeSetItem(K.OPENROUTER_MODEL, v);

export function getSearchHistory() {
  try {
    const raw = safeGetItem(K.HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export function addSearchToHistory(interests, originalIdea = '') {
  let h = getSearchHistory();
  const key = [...interests].sort().join('|').toLowerCase();
  h = h.filter(x => [...x.interests].sort().join('|').toLowerCase() !== key);
  
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  h.unshift({ id, interests, originalIdea, timestamp: new Date().toISOString() });
  safeSetItem(K.HISTORY, JSON.stringify(h.slice(0, 20)));
}
export function clearSearchHistory() { safeSetItem(K.HISTORY, '[]'); }
export function removeSearchFromHistory(id) {
  const h = getSearchHistory().filter(x => String(x.id) !== String(id));
  safeSetItem(K.HISTORY, JSON.stringify(h));
}

// Bookmarks
export function getBookmarks() {
  try {
    const list = JSON.parse(safeGetItem(K.BOOKMARKS) || '[]') || [];
    return list.map(r => ({
      ...r,
      collection: r.collection || 'General',
      // Backwards compatibility logic: read old avgResponseHours if avgCloseHours doesn't exist yet
      avgCloseHours: r.avgCloseHours ?? r.avgResponseHours ?? null
    }));
  } catch {
    return [];
  }
}
export function addBookmark(repo, collectionName = 'General') {
  const bm = getBookmarks();
  if (!bm.find(r => r.id == repo.id)) {
    bm.unshift({ 
      id: repo.id, 
      fullName: repo.fullName, 
      name: repo.name, 
      url: repo.url, 
      stars: repo.stars, 
      language: repo.language, 
      aiScore: repo.aiScore, 
      aiSummary: repo.aiSummary, 
      collection: collectionName || 'General',
      avgCloseHours: repo.avgCloseHours ?? repo.avgResponseHours ?? null,
      savedAt: new Date().toISOString() 
    });
    safeSetItem(K.BOOKMARKS, JSON.stringify(bm));
  }
}
export function removeBookmark(id) {
  safeSetItem(K.BOOKMARKS, JSON.stringify(getBookmarks().filter(r => r.id != id)));
}
export function isBookmarked(id) {
  return getBookmarks().some(r => r.id == id);
}

// Compare list
export function getCompareList() {
  try {
    const list = JSON.parse(safeGetItem(K.COMPARE_LIST) || '[]') || [];
    return list.map(r => ({
      ...r,
      avgCloseHours: r.avgCloseHours ?? r.avgResponseHours ?? null
    }));
  } catch { return []; }
}
export function addToCompare(repo) {
  const list = getCompareList();
  if (list.find(r => r.id == repo.id)) return true;
  if (list.length >= 4) return false;
  
  // Trim the repository object to store only the fields necessary for comparison (saves 80%+ storage)
  const trimmedRepo = {
    id: repo.id,
    name: repo.name,
    url: repo.url,
    aiScore: repo.aiScore,
    stars: repo.stars,
    forks: repo.forks,
    language: repo.language,
    maintenanceStatus: repo.maintenanceStatus,
    safetyFlag: repo.safetyFlag,
    safetyNote: repo.safetyNote,
    difficulty: repo.difficulty,
    sizeLabel: repo.sizeLabel,
    daysSinceUpdate: repo.daysSinceUpdate,
    license: repo.license,
    aiSummary: repo.aiSummary,
    aiPros: repo.aiPros,
    aiCons: repo.aiCons,
    avgCloseHours: repo.avgCloseHours ?? repo.avgResponseHours ?? null
  };

  list.push(trimmedRepo);
  safeSetItem(K.COMPARE_LIST, JSON.stringify(list));
  return true;
}
export function removeFromCompare(id) {
  safeSetItem(K.COMPARE_LIST, JSON.stringify(getCompareList().filter(r => r.id != id)));
}
export function clearCompare() { safeSetItem(K.COMPARE_LIST, '[]'); }
export function isInCompare(id) { return getCompareList().some(r => r.id == id); }

// Likes
export function getLikes() {
  try {
    const list = JSON.parse(safeGetItem(K.LIKES) || '[]') || [];
    return list.map(r => ({
      ...r,
      avgCloseHours: r.avgCloseHours ?? r.avgResponseHours ?? null
    }));
  } catch { return []; }
}
export function toggleLike(repo) {
  let likes = getLikes();
  if (likes.find(r => r.id == repo.id)) {
    likes = likes.filter(r => r.id != repo.id);
  } else {
    likes.unshift({ 
      id: repo.id, 
      fullName: repo.fullName, 
      url: repo.url, 
      stars: repo.stars, 
      language: repo.language, 
      aiScore: repo.aiScore, 
      aiSummary: repo.aiSummary, 
      avgCloseHours: repo.avgCloseHours ?? repo.avgResponseHours ?? null,
      savedAt: new Date().toISOString() 
    });
  }
  safeSetItem(K.LIKES, JSON.stringify(likes));
  return isLiked(repo.id);
}
export function isLiked(id) {
  return getLikes().some(r => r.id == id);
}

// Recently Viewed
export function getViewed() {
  try { return JSON.parse(safeGetItem(K.VIEWED) || '[]') || []; } catch { return []; }
}
export function addViewed(repo) {
  let viewed = getViewed();
  viewed = viewed.filter(r => r.id != repo.id);
  viewed.unshift({ id: repo.id, fullName: repo.fullName, description: repo.description, url: repo.url, language: repo.language, topics: repo.topics, stars: repo.stars, viewedAt: new Date().toISOString() });
  safeSetItem(K.VIEWED, JSON.stringify(viewed.slice(0, 50)));
}

// ─── Cache ───
export function getCachedResults(interests, provider = '', model = '', searchMode = 'keyword', hasToken = false, originalIdea = '') {
  try {
    const cache = JSON.parse(sessionStorage.getItem(K.CACHE)) || {};
    // Avoid mutational side effects: make copy of interests array before sorting
    const sortedInterests = [...interests].sort().join(',').toLowerCase();
    // Cache key incorporates searchMode, originalIdea, token settings and provider configuration
    const key = `${searchMode}::${originalIdea}::${sortedInterests}::${provider}::${model}::${hasToken}::v1`;
    const entry = cache[key];
    if (entry && (Date.now() - entry.timestamp < 3600000)) { // 1 hour cache
      return entry.data;
    }
  } catch { return null; }
  return null;
}

export function setCachedResults(interests, data, provider = '', model = '', searchMode = 'keyword', hasToken = false, originalIdea = '') {
  try {
    const cache = JSON.parse(sessionStorage.getItem(K.CACHE)) || {};
    const sortedInterests = [...interests].sort().join(',').toLowerCase();
    const key = `${searchMode}::${originalIdea}::${sortedInterests}::${provider}::${model}::${hasToken}::v1`;
    cache[key] = { data, timestamp: Date.now() };
    safeSetSessionItem(K.CACHE, JSON.stringify(cache));
  } catch {}
}

export function clearCache() { sessionStorage.removeItem(K.CACHE); }

// Chat history persistence
export function getChatHistoryForRepo(repoFullName) {
  try {
    const historyMap = JSON.parse(safeGetItem(K.CHAT_HISTORY) || '{}') || {};
    return historyMap[repoFullName] || [];
  } catch {
    return [];
  }
}

export function saveChatHistoryForRepo(repoFullName, history) {
  try {
    const historyMap = JSON.parse(safeGetItem(K.CHAT_HISTORY) || '{}') || {};
    historyMap[repoFullName] = history;
    safeSetItem(K.CHAT_HISTORY, JSON.stringify(historyMap));
  } catch (e) {
    console.error('Error saving chat history:', e);
  }
}

export function clearChatHistoryForRepo(repoFullName) {
  try {
    const historyMap = JSON.parse(safeGetItem(K.CHAT_HISTORY) || '{}') || {};
    delete historyMap[repoFullName];
    safeSetItem(K.CHAT_HISTORY, JSON.stringify(historyMap));
  } catch (e) {
    console.error('Error clearing chat history:', e);
  }
}

// Collections Support
export function getCollections() {
  const bm = getBookmarks();
  const list = ['General'];
  const lowerList = ['general'];

  bm.forEach(r => {
    const col = (r.collection || 'General').trim();
    const colLower = col.toLowerCase();
    if (!lowerList.includes(colLower)) {
      list.push(col);
      lowerList.push(colLower);
    }
  });

  try {
    const custom = JSON.parse(safeGetItem('rr_custom_collections') || '[]') || [];
    custom.forEach(c => {
      const col = c.trim();
      const colLower = col.toLowerCase();
      if (!lowerList.includes(colLower)) {
        list.push(col);
        lowerList.push(colLower);
      }
    });
  } catch {}

  return list;
}

export function createCollection(name) {
  const n = (name || '').trim().replace(/[^\w\s-]/g, '').substring(0, 30);
  if (!n) return false;
  if (n.toLowerCase() === 'general') return false;
  try {
    const custom = JSON.parse(safeGetItem('rr_custom_collections') || '[]') || [];
    const exists = custom.some(c => c.toLowerCase() === n.toLowerCase());
    if (!exists) {
      custom.push(n);
      safeSetItem('rr_custom_collections', JSON.stringify(custom));
      return true;
    }
  } catch {}
  return false;
}

export function deleteCollection(name) {
  const n = (name || '').trim();
  if (!n || n.toLowerCase() === 'general') return;
  try {
    // 1. Remove from custom collections
    let custom = JSON.parse(safeGetItem('rr_custom_collections') || '[]') || [];
    custom = custom.filter(c => c.toLowerCase() !== n.toLowerCase());
    safeSetItem('rr_custom_collections', JSON.stringify(custom));

    // 2. Move bookmarks in this collection back to General
    const bm = getBookmarks();
    const updated = bm.map(r => {
      if (r.collection && r.collection.toLowerCase() === n.toLowerCase()) {
        return { ...r, collection: 'General' };
      }
      return r;
    });
    safeSetItem(K.BOOKMARKS, JSON.stringify(updated));
  } catch {}
}

export function renameCollection(oldName, newName) {
  const oldN = (oldName || '').trim();
  const newN = (newName || '').trim().replace(/[^\w\s-]/g, '').substring(0, 30);
  if (!oldN || !newN || oldN.toLowerCase() === 'general' || newN.toLowerCase() === 'general') return false;
  if (oldN.toLowerCase() === newN.toLowerCase()) return true;

  try {
    // 1. Rename in custom collections
    const custom = JSON.parse(safeGetItem('rr_custom_collections') || '[]') || [];
    const idx = custom.findIndex(c => c.toLowerCase() === oldN.toLowerCase());
    
    // Check if the new name already exists
    const exists = custom.some(c => c.toLowerCase() === newN.toLowerCase());
    if (exists) return false; // cannot rename to an existing collection name

    if (idx !== -1) {
      custom[idx] = newN;
    } else {
      custom.push(newN);
    }
    safeSetItem('rr_custom_collections', JSON.stringify(custom));

    // 2. Rename in bookmarks
    const bm = getBookmarks();
    const updated = bm.map(r => {
      if (r.collection && r.collection.toLowerCase() === oldN.toLowerCase()) {
        return { ...r, collection: newN };
      }
      return r;
    });
    safeSetItem(K.BOOKMARKS, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function moveBookmarkToCollection(id, collectionName) {
  const colName = (collectionName || 'General').trim();
  if (colName && colName.toLowerCase() !== 'general') {
    createCollection(colName);
  }
  const bm = getBookmarks();
  const updated = bm.map(r => {
    if (r.id == id) {
      return { ...r, collection: colName };
    }
    return r;
  });
  safeSetItem(K.BOOKMARKS, JSON.stringify(updated));
}

/**
 * Opens browser-based IndexedDB for Git Scout file chunks caching.
 */
export function openIndexedDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported'));
    }
    const request = indexedDB.open('gitscout_chunks_db', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('file_chunks')) {
        db.createObjectStore('file_chunks', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Saves file segments (chunks) to local IndexedDB store.
 */
export async function saveRepoChunks(repoFullName, chunks) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('file_chunks', 'readwrite');
      const store = tx.objectStore('file_chunks');
      
      chunks.forEach(c => {
        store.put({
          id: c.id,
          repoFullName,
          filePath: c.filePath,
          content: c.content,
          startLine: c.startLine,
          endLine: c.endLine
        });
      });
      
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to save repo chunks to IndexedDB:', err);
    return false;
  }
}

/**
 * Retrieves cached file segments for a given repository.
 */
export async function getRepoChunks(repoFullName) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('file_chunks', 'readonly');
      const store = tx.objectStore('file_chunks');
      const results = [];
      
      const request = store.openCursor();
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.repoFullName === repoFullName) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Failed to get repo chunks from IndexedDB:', err);
    return [];
  }
}



