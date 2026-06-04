/**
 * search.js — Discovery tag inputs, suggestions, and main search execution pipeline.
 */

import {
  state,
  setCurrentInterests,
  setLastSearchedRepos,
  setIsSearching,
  setCurrentPage,
  setActiveSearchInterests
} from './state.js';

import { searchRepos, enrichRepos } from './github.js';
import { translateIdeaToKeywords, checkOllamaStatus, DEFAULT_MODELS, analyzeRepos } from './ai.js';
import {
  renderLoadingState,
  updateLoadingMessage,
  updateProgress,
  renderError,
  showToast,
  updateLoadingStep
} from './ui.js';

import {
  renderResults,
  scrollToResults
} from './results.js';

import { extractSignificantKeywords } from './utils.js';


import {
  getAiProvider,
  getGroqApiKey,
  getOpenAiKey,
  getAnthropicKey,
  getGeminiKey,
  getAiModel,
  getGroqModel,
  getOpenAiModel,
  getAnthropicModel,
  getGeminiModel,
  getGithubToken,
  addSearchToHistory,
  getCachedResults,
  setCachedResults
} from './storage.js';

import { switchTab } from './navigation.js';

export const QUICK_INTERESTS = [
  'Machine Learning','Web Development','Game Dev','DevOps','Cybersecurity',
  'Mobile Apps','Data Science','Blockchain','Cloud Computing','Open Source Tools',
  'Automation','APIs','Computer Vision','NLP','Robotics','Embedded Systems',
  'UI/UX Design','Database','Networking','Compilers',
];

export function esc(t) {
  if (!t) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function updateResultsTabBadge(count) {
  const badge = document.getElementById('results-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

export function renderTags() {
  const wrapper = document.getElementById('interest-tags');
  if (!wrapper) return;

  const modeEl = document.querySelector('input[name="search-mode"]:checked');
  const searchMode = modeEl ? modeEl.value : 'repo';

  if (searchMode === 'idea') {
    wrapper.style.display = 'none';
    wrapper.innerHTML = '';
    const input = document.getElementById('interest-input');
    if (input) {
      input.placeholder = 'Type your technical idea (e.g. fitness app using camera)...';
    }
    return;
  }

  wrapper.style.display = 'flex';
  wrapper.innerHTML = state.currentInterests.map(t => `
    <span class="interest-tag">
      ${esc(t)}
      <span class="remove" onclick="this.parentElement.remove(); window.dispatchEvent(new CustomEvent('remove-tag', { detail: '${esc(t)}' }))">&times;</span>
    </span>
  `).join('');

  const input = document.getElementById('interest-input');
  if (input) {
    if (state.currentInterests.length > 0) {
      input.placeholder = '';
    } else {
      input.placeholder = 'Type interest or paste GitHub URL...';
    }
  }
}

export function addInterest(text) {
  const modeEl = document.querySelector('input[name="search-mode"]:checked');
  const searchMode = modeEl ? modeEl.value : 'repo';
  if (searchMode === 'idea') return; // Do not add chips in Idea mode
  
  const clean = text.trim();
  if (clean && !state.currentInterests.includes(clean)) {
    setCurrentInterests([...state.currentInterests, clean]);
    renderTags();
    const input = document.getElementById('interest-input');
    if (input) input.value = '';
    setTimeout(updateSearchBtn, 0);
  }
}

export function removeInterest(text) {
  setCurrentInterests(state.currentInterests.filter(t => t !== text));
  renderTags();
  updateSearchBtn();
}

export function autoResizeInput() {
  const input = document.getElementById('interest-input');
  if (!input) return;
  if (input.tagName.toLowerCase() === 'textarea') {
    input.style.height = '24px';
    const newHeight = Math.max(input.scrollHeight, 24);
    input.style.height = Math.min(newHeight, 200) + 'px';
  }
}

export function updateSearchBtn() { 
  const input = document.getElementById('interest-input');
  const btn = document.getElementById('search-btn');
  if (!btn) return;
  if (state.isSearching) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scouting...</span>`;
  } else {
    btn.removeAttribute('aria-busy');
    const inputVal = input ? input.value.trim() : '';
    btn.disabled = !state.currentInterests.length && !inputVal;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Scout</span>`;
  }
}

export function initInterestInput() {
  const input = document.getElementById('interest-input');
  if (!input) return;
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const modeEl = document.querySelector('input[name="search-mode"]:checked');
      const searchMode = modeEl ? modeEl.value : 'repo';
      if (searchMode === 'idea') {
        if (e.shiftKey) {
          // Allow shift+enter newline
          return;
        }
        e.preventDefault();
        executeSearch();
      } else {
        e.preventDefault();
        const val = input.value.trim().replace(/,$/, '');
        if (val) addInterest(val);
      }
    } else if (e.key === ',') {
      const modeEl = document.querySelector('input[name="search-mode"]:checked');
      const searchMode = modeEl ? modeEl.value : 'repo';
      if (searchMode !== 'idea') {
        e.preventDefault();
        const val = input.value.trim().replace(/,$/, '');
        if (val) addInterest(val);
      }
    }
  });

  input.addEventListener('blur', () => {
    const modeEl = document.querySelector('input[name="search-mode"]:checked');
    const searchMode = modeEl ? modeEl.value : 'repo';
    if (searchMode === 'idea') return; // In idea mode, do not convert raw input on blur
    
    const val = input.value.trim();
    if (val) addInterest(val);
  });
  
  input.addEventListener('input', () => {
    updateSearchBtn();
    autoResizeInput();
  });

  // Search mode radio buttons change listener
  document.querySelectorAll('input[name="search-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderTags();
      updateSearchBtn();
      autoResizeInput();
    });
  });
}

export function initQuickPicks() {
  const c = document.getElementById('quick-picks');
  if (!c) return;
  c.innerHTML = QUICK_INTERESTS.map(t => `
    <button class="quick-chip" data-interest="${esc(t)}">+ ${esc(t)}</button>
  `).join('');
  
  c.querySelectorAll('.quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      addInterest(btn.dataset.interest);
    });
  });
  
  const showMore = document.getElementById('show-more-picks');
  if (showMore) {
    showMore.addEventListener('click', () => {
      c.classList.toggle('expanded');
      showMore.textContent = c.classList.contains('expanded') ? 'Show less ▴' : 'Show more ▾';
    });
  }
}

export function initSearchButton() {
  const sBtn = document.getElementById('search-btn');
  if (sBtn) sBtn.addEventListener('click', executeSearch);
}

export function initRotatingText() {
  const el = document.getElementById('rotating-text');
  if (!el) return;
  const items = ['AI models', 'security tools', 'game engines', 'devops utilities', 'productivity apps'];
  let idx = 0;
  
  const rotate = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => {
      el.textContent = items[idx];
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      idx = (idx + 1) % items.length;
    }, 400);
  };
  
  rotate();
  setInterval(rotate, 3000);
}

export function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      const overlay = document.querySelector('.modal-overlay.open');
      if (!overlay) {
        const input = document.getElementById('interest-input');
        if (input) {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => input.focus(), 300);
        }
      }
    }
    if (e.key === 'Escape' && document.activeElement?.id === 'interest-input') {
      document.activeElement.blur();
    }
  });
}

export async function executeSearch() {
  if (state.isSearching) return;

  const provider = getAiProvider();
  let apiKey = '';
  if (provider === 'groq') apiKey = getGroqApiKey();
  if (provider === 'openai') apiKey = getOpenAiKey();
  if (provider === 'anthropic') apiKey = getAnthropicKey();
  if (provider === 'gemini') apiKey = getGeminiKey();

  if (provider !== 'ollama' && !apiKey) {
    showToast(`Add your ${provider} API key in Settings!`, 'error');
    const settingsOverlay = document.getElementById('settings-modal-overlay');
    if (settingsOverlay) settingsOverlay.classList.add('open');
    return;
  }
  if (provider === 'ollama') {
    const status = await checkOllamaStatus();
    if (!status.running) {
      showToast('Ollama is not running! Start it with: ollama serve', 'error');
      return;
    }
  }

  const input = document.getElementById('interest-input');
  const inputVal = input ? input.value.trim() : '';
  const searchModeEl = document.querySelector('input[name="search-mode"]:checked');
  const searchMode = searchModeEl ? searchModeEl.value : 'repo';

  // Auto-convert raw input to chip in keyword mode
  if (searchMode === 'repo' && inputVal) {
    if (!state.currentInterests.includes(inputVal)) {
      setCurrentInterests([...state.currentInterests, inputVal]);
      renderTags();
    }
    if (input) input.value = '';
  }

  // Determine user's query/idea
  let originalIdea = '';
  if (searchMode === 'idea') {
    originalIdea = inputVal;
  } else {
    originalIdea = state.currentInterests.join(' ');
  }

  if (!originalIdea.trim()) {
    showToast('Please enter technical interests or an idea to search!', 'error');
    return;
  }

  setIsSearching(true);
  updateSearchBtn();

  const resultsContainer = document.getElementById('results');
  if (resultsContainer) resultsContainer.style.display = 'block';
  switchTab('results');

  const results = document.getElementById('results');
  
  try {
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;

    // ─── Cache Check ───
    const hasToken = !!getGithubToken();
    const cached = getCachedResults(searchMode === 'idea' ? [] : state.currentInterests, provider, model, searchMode, hasToken, originalIdea);
    if (cached) {
      // Safely calculate which page we are on based on cached results density
      setCurrentPage(Math.max(2, Math.ceil(cached.length / 30)));

      const dash = document.getElementById('welcome-dashboard');
      if (dash) dash.style.display = 'none';
      setLastSearchedRepos(cached);
      renderResults(cached, results);
      updateResultsTabBadge(cached.length);

      const searchMoreBtn = document.getElementById('search-more-btn');
      if (searchMoreBtn) {
        searchMoreBtn.style.display = 'inline-flex';
        searchMoreBtn.disabled = false;
        searchMoreBtn.innerHTML = 'Search More';
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Loaded from cache ⚡');
      
      setIsSearching(false);
      updateSearchBtn();
      return;
    }

    renderLoadingState(results, 'Analyzing your request...');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const dash = document.getElementById('welcome-dashboard');
    if (dash) dash.style.display = 'none';

    // Check Search Mode (Idea vs Repo)
    let searchInterests = [...state.currentInterests];
    
    if (searchMode === 'idea') {
      updateLoadingStep('search');
      updateLoadingMessage('Agent 2 Matchmaker: Translating idea to search keywords...');
      showToast('💡 Matchmaker is translating your idea...', 'success');
      
      let newKeywords;
      try {
        newKeywords = await translateIdeaToKeywords(originalIdea, { provider, apiKey, model });
        if (newKeywords && newKeywords.length) {
          if (!Array.isArray(newKeywords[0])) {
            newKeywords = [newKeywords];
          }
          const flatKeywords = newKeywords.map(arr => arr.join(' + ')).join(', ');
          showToast(`🔍 Searching for: ${flatKeywords}`, 'success');
        }
      } catch (err) {
        console.warn('AI Matchmaker translation failed. Falling back to keyword mode.', err);
        const extracted = extractSignificantKeywords(originalIdea);
        newKeywords = [extracted];
        showToast('⚠️ Matchmaker translation failed. Falling back to normal keyword search.', 'warning');
      }

      if (newKeywords && newKeywords.length) {
        searchInterests = newKeywords;
        // Do not overwrite raw user input tags in the header
      }
    }

    updateLoadingStep('search');
    updateLoadingMessage('Searching GitHub repositories...');
    updateProgress(10);
    setActiveSearchInterests(searchInterests);
    
    let repos = [];
    if (searchMode === 'idea' && Array.isArray(searchInterests) && Array.isArray(searchInterests[0])) {
      const seen = new Set();
      for (const queryKeywords of searchInterests) {
        const pageRepos = await searchRepos(queryKeywords, {
          token: getGithubToken(),
          includeTopicSearch: false
        });
        for (const r of pageRepos) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            repos.push(r);
          }
        }
      }
    } else {
      repos = await searchRepos(searchInterests, { token: getGithubToken() });
    }
    if (!repos.length) { renderError(results, 'No repos found. Try broader terms.'); return; }
    updateProgress(25);

    updateLoadingStep('enrich');
    const token = getGithubToken();
    const limit = token ? 30 : 6;
    updateLoadingMessage(`Enriching top ${Math.min(limit, repos.length)} repos...`);
    const topRepos = repos.slice(0, limit);
    const enriched = await enrichRepos(topRepos, token, (done, total) => {
      updateProgress(25 + Math.round((done / total) * 25));
    });
    updateProgress(50);

    updateLoadingStep('analyze');
    updateLoadingMessage('Agent 1 Analyst: Scoring & creating report cards...');
    const flatInterests = searchMode === 'idea' ? searchInterests.flat() : searchInterests;
    const analyzed = await analyzeRepos(enriched, flatInterests, { provider, apiKey, model }, (done, total) => {
      updateProgress(50 + Math.round((done / total) * 45));
    });
    updateProgress(100);

    setLastSearchedRepos(analyzed);
    renderResults(analyzed, results);
    updateResultsTabBadge(analyzed.length);

    setCurrentPage(2);
    const searchMoreBtn = document.getElementById('search-more-btn');
    if (searchMoreBtn) {
      searchMoreBtn.style.display = 'inline-flex';
      searchMoreBtn.disabled = false;
      searchMoreBtn.innerHTML = 'Search More';
    }
    
    // Save to history & set search cache
    if (searchMode === 'idea') {
      addSearchToHistory([], originalIdea);
      setCachedResults([], analyzed, provider, model, searchMode, hasToken, originalIdea);
    } else {
      addSearchToHistory(state.currentInterests, originalIdea);
      setCachedResults(state.currentInterests, analyzed, provider, model, searchMode, hasToken, originalIdea);
    }
    
    // Trigger live dashboard recents reload
    document.dispatchEvent(new CustomEvent('viewed-updated'));
    showToast('Search completed! 🔭');
  } catch (err) {
    console.error('executeSearch error:', err);
    renderError(results, err.message);
  } finally {
    setIsSearching(false);
    updateSearchBtn();
  }
}

export async function executeSearchMore() {
  if (state.isSearching) return;
  const btn = document.getElementById('search-more-btn');
  if (!btn) return;

  const provider = getAiProvider();
  let apiKey = '';
  if (provider === 'groq') apiKey = getGroqApiKey();
  if (provider === 'openai') apiKey = getOpenAiKey();
  if (provider === 'anthropic') apiKey = getAnthropicKey();
  if (provider === 'gemini') apiKey = getGeminiKey();

  if (provider !== 'ollama' && !apiKey) {
    showToast(`Add your ${provider} API key in Settings!`, 'error');
    const settingsOverlay = document.getElementById('settings-modal-overlay');
    if (settingsOverlay) settingsOverlay.classList.add('open');
    return;
  }
  if (provider === 'ollama') {
    const status = await checkOllamaStatus();
    if (!status.running) {
      showToast('Ollama is not running! Start it with: ollama serve', 'error');
      return;
    }
  }

  setIsSearching(true);
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scouting Page ${state.currentPage + 1}...</span>`;

  try {
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;

    const token = getGithubToken();
    const nextPage = state.currentPage + 1;
    const searchInterests = state.activeSearchInterests.length ? state.activeSearchInterests : state.currentInterests;
    const modeEl = document.querySelector('input[name="search-mode"]:checked');
    const searchMode = modeEl ? modeEl.value : 'repo';
    
    let repos = [];
    if (searchMode === 'idea' && Array.isArray(searchInterests) && Array.isArray(searchInterests[0])) {
      const seen = new Set();
      for (const queryKeywords of searchInterests) {
        const pageRepos = await searchRepos(queryKeywords, {
          token,
          page: nextPage,
          includeTopicSearch: false
        });
        for (const r of pageRepos) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            repos.push(r);
          }
        }
      }
    } else {
      repos = await searchRepos(searchInterests, {
        token,
        page: nextPage,
        includeTopicSearch: false
      });
    }

    const existingIds = new Set(state.lastSearchedRepos.map(r => r.id));
    const uniqueNew = repos.filter(r => !existingIds.has(r.id));

    if (uniqueNew.length === 0) {
      showToast('No more new repositories found.', 'warning');
      btn.innerHTML = 'No more results';
      btn.disabled = true;
      setIsSearching(false);
      return;
    }

    const limit = token ? 30 : 6;
    const uniqueToEnrich = uniqueNew.slice(0, limit);

    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Enriching (0/${uniqueToEnrich.length})...</span>`;

    const enriched = await enrichRepos(uniqueToEnrich, token, (done, total) => {
      btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Enriching (${done}/${total})...</span>`;
    });

    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scoring AI cards...</span>`;

    const flatInterests = searchMode === 'idea' ? searchInterests.flat() : searchInterests;
    const analyzed = await analyzeRepos(enriched, flatInterests, { provider, apiKey, model });

    const updatedRepos = [...state.lastSearchedRepos, ...analyzed];
    setLastSearchedRepos(updatedRepos);

    const input = document.getElementById('interest-input');
    const originalIdea = searchMode === 'idea' ? (input ? input.value.trim() : '') : state.currentInterests.join(' ');
    const hasToken = !!getGithubToken();
    if (searchMode === 'idea') {
      setCachedResults([], updatedRepos, provider, model, searchMode, hasToken, originalIdea);
    } else {
      setCachedResults(state.currentInterests, updatedRepos, provider, model, searchMode, hasToken, originalIdea);
    }

    renderResults(updatedRepos, document.getElementById('results'));
    scrollToResults();

    setCurrentPage(nextPage);
    updateResultsTabBadge(updatedRepos.length);

    btn.disabled = false;
    btn.innerHTML = 'Search More';
    
    // Ensure Search More button is still visible and displayed block after renderResults wipes out results div
    const searchMoreBtn = document.getElementById('search-more-btn');
    if (searchMoreBtn) {
      searchMoreBtn.style.display = 'inline-flex';
      searchMoreBtn.disabled = false;
      searchMoreBtn.innerHTML = 'Search More';
    }

    showToast('Loaded more results! 🔭');
  } catch (err) {
    console.error('executeSearchMore error:', err);
    showToast(`Search more failed: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = 'Search More';
  } finally {
    setIsSearching(false);
  }
}

// Window Event Listeners for search tags
window.addEventListener('remove-tag', (e) => removeInterest(e.detail));
