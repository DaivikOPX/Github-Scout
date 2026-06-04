/**
 * main.js — App entry with Ollama/Groq provider switching, bookmarks panel
 */
import './style.css';
import DOMPurify from 'dompurify';
import { searchRepos, enrichRepos, fetchRepoTree, fetchRepoIssues, fetchRepoFileContent } from './src/github.js';
import { analyzeRepos, checkOllamaStatus, generateDeepDive, translateIdeaToKeywords, chatAboutRepo, DEFAULT_MODELS, explainFileCode, explainDependency, explainFileChunk, summarizeFullFile } from './src/ai.js';
import { renderResults, renderLoadingState, updateLoadingMessage, updateProgress, renderError, showToast, scrollToResults } from './src/ui.js';
import {
  getGroqApiKey, setGroqApiKey, getGithubToken, setGithubToken, getGroqModel, setGroqModel,
  getOpenAiKey, setOpenAiKey, getAnthropicKey, setAnthropicKey, getGeminiKey, setGeminiKey,
  getOpenAiModel, setOpenAiModel, getAnthropicModel, setAnthropicModel, getGeminiModel, setGeminiModel,
  getAiProvider, setAiProvider, getAiModel, setAiModel,
  addSearchToHistory, getSearchHistory, removeSearchFromHistory,
  getBookmarks, removeBookmark, getLikes, getViewed, addViewed, getCompareList,
  getCachedResults, setCachedResults,
  getCollections, createCollection, deleteCollection, renameCollection, moveBookmarkToCollection,
  getChatHistoryForRepo, saveChatHistoryForRepo, clearChatHistoryForRepo
} from './src/storage.js';
import { updateLoadingStep } from './src/ui.js';
import { buildDirectoryTree, parseMarkdown, extractJsonObjects, parseManifestDependencies } from './src/utils.js';

const QUICK_INTERESTS = [
  'Machine Learning','Web Development','Game Dev','DevOps','Cybersecurity',
  'Mobile Apps','Data Science','Blockchain','Cloud Computing','Open Source Tools',
  'Automation','APIs','Computer Vision','NLP','Robotics','Embedded Systems',
  'UI/UX Design','Database','Networking','Compilers',
];

let currentInterests = [];
let lastSearchedRepos = [];
let activeDeepDiveRepo = null;
let activeFileTree = [];
let activeReportText = '';
let currentDeepDiveId = 0;
let deepDiveAbortController = null;
let isSearching = false;
let currentPage = 2;
let activeSearchInterests = [];
let chatHistory = [];
let isWaitingForAi = false;
let runDeepDiveGeneration = null;
let loadChatStateForRepo = null;

const fileExplainerCache = new Map();
const dependencyExplainerCache = new Map();
let currentFileExplainerId = 0;
let fileExplainerAbortController = null;
let currentDependencyExplainerId = 0;
let dependencyExplainerAbortController = null;

let currentTab = 'home';

function switchTab(tabId) {
  // If attempting to switch to results but there are no results loaded, redirect to home
  if (tabId === 'results') {
    const resultsContainer = document.getElementById('results');
    if (!resultsContainer || resultsContainer.children.length === 0 || resultsContainer.style.display === 'none') {
      if (typeof isSearching !== 'undefined' && !isSearching) {
        tabId = 'home';
      }
    }
  }

  const tabs = document.querySelectorAll('#main-nav-tabs .nav-tab');
  const panes = document.querySelectorAll('.tab-pane');
  
  tabs.forEach(tab => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  
  panes.forEach(pane => {
    const isActive = pane.id === `pane-${tabId}`;
    pane.classList.toggle('active', isActive);
    pane.style.display = isActive ? 'block' : 'none';
  });

  currentTab = tabId;
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Update hash to support browser back button navigation
  if (window.location.hash.slice(1) !== tabId) {
    window.location.hash = tabId;
  }
}

// Global browser Back/Forward navigation event listener
window.addEventListener('hashchange', () => {
  const tabId = window.location.hash.slice(1) || 'home';
  if (['home', 'results'].includes(tabId)) {
    const pane = document.getElementById('pane-' + tabId);
    if (pane && pane.style.display !== 'block') {
      switchTab(tabId);
    }
  }
});

function initTabKeyboardNavigation() {
  const tabContainer = document.getElementById('main-nav-tabs');
  if (!tabContainer) return;
  
  const tabs = Array.from(tabContainer.querySelectorAll('.nav-tab'));
  const tabIds = ['home', 'results', 'deep-dive'];
  
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
    
    tab.addEventListener('keydown', (e) => {
      let nextIndex = index;
      if (e.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }
      
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      nextTab.focus();
      switchTab(tabIds[nextIndex]);
    });
  });
}

function formatNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k'; return ''+n;
}

function updateResultsTabBadge(count) {
  const badge = document.getElementById('results-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
    }
    // Setup initial hash route on page load
    const initialTab = window.location.hash.slice(1) || 'home';
    if (['home', 'results', 'deep-dive'].includes(initialTab)) {
      switchTab(initialTab);
    }

    initSettingsPanel();
    initNavbarScroll();
    initInterestInput();
    initQuickPicks();
    initSearchButton();
    initHistoryDropdown();
    initBookmarksPanel();
    restoreSettings();
    
    // Do not run Ollama checks on startup to speed up page load and prevent unnecessary local queries
    
    // New UI Initializers
    initRotatingText();
    initBackToTop();
    document.addEventListener('bookmarks-updated', () => {
      updateBookmarkBadge();
      initWelcomeDashboard();
    });
    document.addEventListener('viewed-updated', () => {
      initWelcomeDashboard();
    });
    initResultsActions();
    initWelcomeDashboard();
    initKeyboardShortcuts();
    initTabKeyboardNavigation();

    // Catch storage failure events decoupled from storage layer
    window.addEventListener('localstorage-failure', (e) => {
      showToast('⚠️ Storage limit reached! Please clear some bookmarks or history to save new data.', 'error');
    });
  } catch (err) {
    console.error('Initialization error:', err);
  }
});

function initWelcomeDashboard() {
  const container = document.getElementById('welcome-dashboard');
  if (!container) return;

  const tabContainer = document.getElementById('dashboard-slim-tabs');
  if (!tabContainer) return;

  const ddModal = document.getElementById('deep-dive-modal-overlay');
  const ddTitle = document.getElementById('deep-dive-title');
  const ddControls = document.getElementById('deep-dive-controls');

  let activeTab = 'recents';
  const activeTabBtn = tabContainer.querySelector('.dash-tab-btn.active');
  if (activeTabBtn) {
    activeTab = activeTabBtn.dataset.tab;
  }

  const renderContent = () => {
    const list = container.querySelector('#dashboard-slim-content');
    if (!list) return;

    if (activeTab === 'recents') {
      const h = getSearchHistory();
      if (!h.length) {
        list.innerHTML = '<p class="dash-empty">No recent searches yet.</p>';
        return;
      }
      list.innerHTML = h.map(x => {
        const label = x.originalIdea ? `💡 ${x.originalIdea}` : `🔍 ${x.interests.join(', ')}`;
        return `
          <div class="dash-row" data-id="${x.id}" style="cursor:pointer;">
            <span class="dash-item-main">${esc(label)}</span>
            <span class="dash-item-sub font-mono">${new Date(x.timestamp).toLocaleDateString()}</span>
          </div>
        `;
      }).join('');

      list.querySelectorAll('.dash-row').forEach(row => {
        row.onclick = () => {
          const item = h.find(x => String(x.id) === String(row.dataset.id));
          if (item) {
            if (item.originalIdea) {
              const radioIdea = document.querySelector('input[name="search-mode"][value="idea"]');
              if (radioIdea) radioIdea.checked = true;
              document.getElementById('interest-input').value = item.originalIdea;
              currentInterests = [];
            } else {
              const radioRepo = document.querySelector('input[name="search-mode"][value="repo"]');
              if (radioRepo) radioRepo.checked = true;
              document.getElementById('interest-input').value = '';
              currentInterests = [...item.interests];
            }
            renderTags();
            updateSearchBtn();
            executeSearch();
          }
        };
      });
    }

    if (activeTab === 'viewed') {
      const v = getViewed();
      if (!v.length) {
        list.innerHTML = '<p class="dash-empty">No recently viewed repositories yet.</p>';
        return;
      }
      list.innerHTML = v.map(x => `
        <div class="dash-row" data-fullName="${x.fullName}" style="cursor:pointer;">
          <span class="dash-item-main">📁 ${esc(x.fullName)}</span>
          <span class="dash-item-sub">⭐ ${formatNum(x.stars)} · ${x.language}</span>
        </div>
      `).join('');

      list.querySelectorAll('.dash-row').forEach(row => {
        row.onclick = () => {
          const fullName = row.dataset.fullname;
          const repo = v.find(x => x.fullName === fullName);
          if (repo && ddTitle && ddControls && ddModal) {
            activeDeepDiveRepo = { fullName: repo.fullName, id: repo.id };
            document.getElementById('settings-modal-overlay').classList.remove('open');
            document.getElementById('bookmarks-modal-overlay').classList.remove('open');
            ddTitle.textContent = `🧠 Deep Dive: ${repo.fullName.split('/')[1]}`;
            ddControls.style.display = 'flex';
            
            ddModal.classList.add('open');

            loadChatStateForRepo(repo.fullName);
            runDeepDiveGeneration(repo.fullName, repo.id);
          }
        };
      });
    }

    if (activeTab === 'favorites') {
      const likes = getLikes();
      if (!likes.length) {
        list.innerHTML = '<p class="dash-empty">No favorites yet.</p>';
        return;
      }
      list.innerHTML = likes.map(x => `
        <div class="dash-row" data-fullName="${x.fullName}" style="cursor:pointer;">
          <span class="dash-item-main">❤️ ${esc(x.fullName)}</span>
          <span class="dash-item-sub">Score: ${x.aiScore}/10 · ${x.language}</span>
        </div>
      `).join('');

      list.querySelectorAll('.dash-row').forEach(row => {
        row.onclick = () => {
          const fullName = row.dataset.fullname;
          const repo = likes.find(x => x.fullName === fullName);
          if (repo && ddTitle && ddControls && ddModal) {
            activeDeepDiveRepo = { fullName: repo.fullName, id: repo.id };
            document.getElementById('settings-modal-overlay').classList.remove('open');
            document.getElementById('bookmarks-modal-overlay').classList.remove('open');
            ddTitle.textContent = `🧠 Deep Dive: ${repo.fullName.split('/')[1]}`;
            ddControls.style.display = 'flex';
            
            ddModal.classList.add('open');

            loadChatStateForRepo(repo.fullName);
            runDeepDiveGeneration(repo.fullName, repo.id);
          }
        };
      });
    }
  };

  const tabs = tabContainer.querySelectorAll('.dash-tab-btn');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderContent();
    };
  });

  renderContent();
}

function initRotatingText() {
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

function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initKeyboardShortcuts() {
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

// Compact Hero New Search button was removed in favor of pure pristine tab dashboard layout.

function initResultsActions() {
  const ddModal = document.getElementById('deep-dive-modal-overlay');
  const ddClose = document.getElementById('deep-dive-close');
  const ddContent = document.getElementById('deep-dive-content');
  const ddTitle = document.getElementById('deep-dive-title');
  const ddControls = document.getElementById('deep-dive-controls');
  
  function abortDeepDive() {
    if (deepDiveAbortController) {
      deepDiveAbortController.abort();
      deepDiveAbortController = null;
    }
    // Safely make any older active generation ticks return early
    currentDeepDiveId++;
  }

  ddClose.addEventListener('click', () => {
    ddModal.classList.remove('open');
    abortDeepDive();
  });
  ddModal.addEventListener('click', (e) => {
    if (e.target === ddModal) {
      ddModal.classList.remove('open');
      abortDeepDive();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ddModal.classList.contains('open')) {
      ddModal.classList.remove('open');
      abortDeepDive();
    }
  });
  
  // Controls listeners
  const slider = document.getElementById('deep-dive-slider');
  const diffLabel = document.getElementById('deep-dive-diff-label');
  if (slider && diffLabel) {
    slider.addEventListener('input', (e) => {
      const vals = { '1': 'Beginner', '2': 'Intermediate', '3': 'Advanced' };
      diffLabel.textContent = vals[e.target.value];
    });
  }

  const advToggleBtn = document.getElementById('dd-advanced-toggle');
  const advDropdown = document.getElementById('dd-advanced-dropdown');
  if (advToggleBtn && advDropdown) {
    advToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      advDropdown.classList.toggle('open');
      advToggleBtn.classList.toggle('active');
    });
    document.addEventListener('click', (ev) => {
      if (!advToggleBtn.contains(ev.target) && !advDropdown.contains(ev.target)) {
        advDropdown.classList.remove('open');
        advToggleBtn.classList.remove('active');
      }
    });
  }
  
  document.getElementById('deep-dive-refresh').addEventListener('click', () => {
    if (activeDeepDiveRepo) {
      resetChatState();
      runDeepDiveGeneration(activeDeepDiveRepo.fullName, activeDeepDiveRepo.id);
    }
  });

  document.getElementById('deep-dive-export').addEventListener('click', () => {
    if (activeDeepDiveRepo) exportDeepDiveToMarkdown(activeDeepDiveRepo.fullName);
  });

  runDeepDiveGeneration = async function(repoFullName, repoId) {
    currentDeepDiveId++;
    const thisDeepDiveId = currentDeepDiveId;

    if (deepDiveAbortController) {
      deepDiveAbortController.abort();
    }
    deepDiveAbortController = new AbortController();
    const { signal } = deepDiveAbortController;

    const statsEl = document.getElementById('deep-dive-sidebar-stats');
    const healthEl = document.getElementById('deep-dive-sidebar-health');
    
    // Premium Shimmer Loading
    const shimmer = '<div class="shimmer" style="height:12px; width:80%; margin-bottom:10px; border-radius:4px;"></div>' + 
                   '<div class="shimmer" style="height:12px; width:60%; margin-bottom:10px; border-radius:4px;"></div>' +
                   '<div class="shimmer" style="height:12px; width:70%; border-radius:4px;"></div>';
    
    ddContent.innerHTML = `
      <div class="loading-state-premium">
        <div class="radar-pulse"></div>
        <div class="loading-text">
          <h3 class="gradient-text">Orchestrating Agents...</h3>
          <p>Architect & Teacher are mapping the codebase</p>
        </div>
      </div>
    `;
    statsEl.innerHTML = shimmer;
    healthEl.innerHTML = shimmer;
    
    try {
      const token = getGithubToken();
      const issues = await fetchRepoIssues(repoFullName, token, signal);
      if (thisDeepDiveId !== currentDeepDiveId) return;
      
      const repoIdNum = Number(repoId);
      let repo = null;
      if (Number.isFinite(repoIdNum)) {
        repo = lastSearchedRepos.find(r => r.id == repoIdNum) ||
               getBookmarks().find(r => r.id == repoIdNum) ||
               getLikes().find(r => r.id == repoIdNum) ||
               getViewed().find(r => r.id == repoIdNum) ||
               getCompareList().find(r => r.id == repoIdNum);
      }
      if (!repo && repoFullName) {
        repo = lastSearchedRepos.find(r => r.fullName === repoFullName) ||
               getBookmarks().find(r => r.fullName === repoFullName) ||
               getLikes().find(r => r.fullName === repoFullName) ||
               getViewed().find(r => r.fullName === repoFullName) ||
               getCompareList().find(r => r.fullName === repoFullName);
      }

      if (!repo && repoFullName) {
        try {
          const headers = { 'Accept': 'application/vnd.github.v3+json' };
          if (token) headers['Authorization'] = `token ${token}`;
          const repoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, { headers, signal });
          if (repoRes.ok) {
            const rawRepo = await repoRes.json();
            const daysSinceUpdate = rawRepo.pushed_at
              ? Math.floor((Date.now() - new Date(rawRepo.pushed_at).getTime()) / 86400000)
              : 9999;
            repo = {
              id: rawRepo.id,
              name: rawRepo.name,
              fullName: rawRepo.full_name,
              url: rawRepo.html_url,
              description: rawRepo.description || 'No description.',
              language: rawRepo.language || 'Unknown',
              stars: rawRepo.stargazers_count,
              forks: rawRepo.forks_count,
              openIssues: rawRepo.open_issues_count,
              watchers: rawRepo.watchers_count,
              size: rawRepo.size,
              createdAt: rawRepo.created_at,
              updatedAt: rawRepo.updated_at,
              pushedAt: rawRepo.pushed_at || null,
              topics: rawRepo.topics || [],
              license: rawRepo.license?.spdx_id || 'No license',
              daysSinceUpdate,
              isRecentlyActive: daysSinceUpdate < 90,
              starToForkRatio: rawRepo.forks_count > 0 ? (rawRepo.stargazers_count / rawRepo.forks_count).toFixed(1) : 'N/A',
              sizeLabel: rawRepo.size < 1000 ? 'Lightweight' : rawRepo.size < 50000 ? 'Medium' : 'Heavy',
              defaultBranch: rawRepo.default_branch || 'main',
              avgCloseHours: null,
              readmeSnippet: '',
            };
          }
        } catch (apiErr) {
          console.warn('Fallback GitHub repository fetch failed:', apiErr);
        }
      }

      const defaultBranch = repo ? repo.defaultBranch : '';
      
      const tree = await fetchRepoTree(repoFullName, token, defaultBranch, signal);
      if (thisDeepDiveId !== currentDeepDiveId) return;
      activeFileTree = tree;
      
      // Render Collapsible Accessible Tree
      const treeContainer = document.getElementById('deep-dive-sidebar-tree');
      if (treeContainer && tree.length) {
        const directoryTreeRoot = buildDirectoryTree(tree);
        treeContainer.innerHTML = renderDirectoryTreeNodes(directoryTreeRoot);
        bindTreeEvents(treeContainer);
      }
      
      // Trigger Manifest & Dependencies Scanner
      if (tree.length) {
        scanAndRenderDependencies(repoFullName, tree, token, defaultBranch, signal);
      }
      
      if (!tree.length) throw new Error(
        token 
          ? 'Could not fetch file tree. The repository might be empty or private.'
          : 'Could not fetch file tree — GitHub API rate limit likely exceeded. Add a GitHub Token in Settings to fix this.'
      );
      
      // Populate Sidebar Stats
      if (repo) {
        statsEl.innerHTML = `
          <div class="dash-list">
            <div class="dash-item"><span class="dash-item-title">⭐ Stars:</span> ${formatNum(repo.stars || 0)}</div>
            <div class="dash-item"><span class="dash-item-title">🍴 Forks:</span> ${formatNum(repo.forks || 0)}</div>
            <div class="dash-item"><span class="dash-item-title">📅 Created:</span> ${repo.createdAt ? new Date(repo.createdAt).toLocaleDateString() : 'Unknown'}</div>
            <div class="dash-item"><span class="dash-item-title">📦 Size:</span> ${repo.sizeLabel || 'Unknown'}</div>
            <div class="dash-item"><span class="dash-item-title">📄 License:</span> ${repo.license || 'None'}</div>
          </div>
        `;

        // Populate Sidebar Health
        const bugs = issues.filter(i => i.isBug).length;
        healthEl.innerHTML = `
          <div class="dash-list">
            <div class="dash-item" style="color:${issues.length > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)'}">
              <span class="dash-item-title">Recent Issues:</span> ${issues.length}
            </div>
            <div class="dash-item" style="color:${bugs > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">
              <span class="dash-item-title">Bug Reports:</span> ${bugs}
            </div>
            <div class="dash-item">
              <span class="dash-item-title">Activity:</span> ${repo.daysSinceUpdate !== undefined ? (repo.daysSinceUpdate < 180 ? '✅ Active' : '⚠️ Stale') : 'Unknown'}
            </div>
          </div>
        `;
      } else {
        // Graceful fallback display if repository metadata fetch failed entirely
        statsEl.innerHTML = `
          <div class="dash-list">
            <div class="dash-item"><span class="dash-item-title">⭐ Stars:</span> Unknown</div>
            <div class="dash-item"><span class="dash-item-title">🍴 Forks:</span> Unknown</div>
            <div class="dash-item"><span class="dash-item-title">📅 Created:</span> Unknown</div>
            <div class="dash-item"><span class="dash-item-title">📦 Size:</span> Unknown</div>
            <div class="dash-item"><span class="dash-item-title">📄 License:</span> Unknown</div>
          </div>
        `;
        const bugs = issues.filter(i => i.isBug).length;
        healthEl.innerHTML = `
          <div class="dash-list">
            <div class="dash-item" style="color:${issues.length > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)'}">
              <span class="dash-item-title">Recent Issues:</span> ${issues.length}
            </div>
            <div class="dash-item" style="color:${bugs > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">
              <span class="dash-item-title">Bug Reports:</span> ${bugs}
            </div>
            <div class="dash-item"><span class="dash-item-title">Activity:</span> Unknown</div>
          </div>
        `;
      }
      
      const provider = getAiProvider();
      let model = '';
      if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
      if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
      if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
      if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
      if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
      
      let apiKey = '';
      if (provider === 'groq') apiKey = getGroqApiKey();
      if (provider === 'openai') apiKey = getOpenAiKey();
      if (provider === 'anthropic') apiKey = getAnthropicKey();
      if (provider === 'gemini') apiKey = getGeminiKey();

      if (provider !== 'ollama' && !apiKey) {
        showToast(`Add your ${provider} API key in Settings for Deep Dive!`, 'error');
        document.getElementById('deep-dive-modal-overlay').classList.remove('open');
        abortDeepDive();
        document.getElementById('settings-modal-overlay').classList.add('open');
        throw new Error(`${provider} API key required`);
      }

      const diffVal = slider ? slider.value : '2';
      const difficulty = diffVal === '1' ? 'Beginner' : diffVal === '3' ? 'Advanced' : 'Intermediate';
      const langEl = document.getElementById('deep-dive-lang');
      const translateTarget = langEl ? langEl.value : '';

      const report = await generateDeepDive(repoFullName, tree, issues, {
        provider, apiKey, model, difficulty, translateTarget, signal
      });
      if (thisDeepDiveId !== currentDeepDiveId) return;
      activeReportText = report;
      
      let reportHTML = report;
      if (tree.isTruncated) {
        // High visibility warning notice for extremely large repos (absolutely no XML tags)
        reportHTML = `
          <div class="warning-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); color: var(--accent-amber); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 0.85rem; display: flex; align-items: center; gap: 10px;">
            <span>⚠️</span>
            <div><strong>Large Repository Notice:</strong> The file tree is extremely large and was truncated for optimal analysis and visualization performance.</div>
          </div>
        ` + reportHTML;
      }
      ddContent.innerHTML = sanitizeHTML(reportHTML);

      // Render Mermaid Flowchart Blueprint
      if (window.mermaid) {
        try {
          // Store original code before mermaid compiles it
          ddContent.querySelectorAll('.mermaid').forEach(mEl => {
            if (!mEl.hasAttribute('data-original-code')) {
              mEl.setAttribute('data-original-code', mEl.textContent.trim());
            }
          });
          
          mermaid.run({
            nodes: ddContent.querySelectorAll('.mermaid')
          });
        } catch (mErr) {
          console.error('Mermaid render failed:', mErr);
        }
      }
    } catch (err) {
      if (thisDeepDiveId !== currentDeepDiveId) return;
      console.error('Deep dive generation failed:', err);
      // Escaping msg using custom HTML escaping helper
      ddContent.innerHTML = `
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <h3>Deep Dive Failed</h3>
          <p>${esc(err.message)}</p>
          ${err.message.includes('API key') ? `
            <p style="font-size:0.9rem; color:var(--text-muted); margin-top:0.5rem;">
              Free GitHub tokens take 30 seconds to create — <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=GitScout" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);">get one here</a>.
            </p>
            <button class="btn btn-primary btn-ripple" id="dd-open-settings" style="margin-top:1rem;">⚙️ Open Settings</button>
          ` : `
            <button class="btn btn-primary btn-ripple" id="dd-retry" style="margin-top:1rem;">↻ Retry</button>
          `}
        </div>
      `;
      // Wire up buttons inside the error state
      const settingsBtn = ddContent.querySelector('#dd-open-settings');
      if (settingsBtn) settingsBtn.addEventListener('click', () => {
        ddModal.classList.remove('open');
        abortDeepDive(); // Cancel outstanding works
        document.getElementById('settings-modal-overlay').classList.add('open');
      });
      const retryBtn = ddContent.querySelector('#dd-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        runDeepDiveGeneration(repoFullName, repoId);
      });
    }
  }

  // Deep Dive Navigation Panel tabs
  const tabBtns = document.querySelectorAll('.dd-tab-btn');
  const tabPanes = document.querySelectorAll('.dd-pane');
  console.log('GitScout Diagnostics: Registered tab buttons count =', tabBtns.length);
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const paneId = btn.dataset.pane;
      console.log('GitScout Diagnostics: tabBtn clicked =', btn.id, 'paneTarget =', paneId);
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });
      
      btn.classList.add('active');
      const activePane = document.getElementById(paneId);
      if (activePane) {
        activePane.classList.add('active');
        activePane.style.display = 'block';
      }
    });
  });

  // Deep Dive Architectural Chat System
  const chatInput = document.getElementById('dd-chat-input');
  const chatSend = document.getElementById('dd-chat-send');
  const chatArea = document.getElementById('dd-chat-messages');
  
  function resetChatState() {
    chatHistory = [];
    chatArea.innerHTML = `
      <div class="dd-chat-welcome">
        <div class="dd-welcome-header">
          <span class="dd-welcome-avatar">🤖</span>
          <h4>Ask the Architect</h4>
          <p>Ask follow-up questions, explore code mechanics, and audit security risks for this repository.</p>
        </div>
        <div class="dd-suggestions-grid">
          <button class="dd-suggestion-btn" data-prompt="Can you explain the folder structure and where key files reside?">
            📂 Folder Structure
          </button>
          <button class="dd-suggestion-btn" data-prompt="How do I get this project up and running locally?">
            ⚙️ Running Locally
          </button>
          <button class="dd-suggestion-btn" data-prompt="What are the potential security risks or licensing issues in this repo?">
            🛡️ Security Risks
          </button>
          <button class="dd-suggestion-btn" data-prompt="What are some creative ways I can extend or build on top of this repository?">
            💡 Creative Extension
          </button>
        </div>
      </div>
    `;

    // Bind click events on suggestions
    chatArea.querySelectorAll('.dd-suggestion-btn').forEach(btn => {
      btn.onclick = () => {
        const promptText = btn.dataset.prompt;
        if (promptText && chatInput) {
          chatInput.value = promptText;
          submitChatMessage();
        }
      };
    });
  }

  loadChatStateForRepo = function(repoFullName) {
    resetChatState();
    const history = getChatHistoryForRepo(repoFullName);
    if (history.length > 0) {
      chatHistory = history;
      // Re-render chat messages
      chatArea.innerHTML = '';
      history.forEach(msg => {
        const isUser = msg.role === 'user';
        const roleClass = isUser ? 'user' : 'architect';
        const avatar = isUser ? '👤' : '🤖';

        const msgDiv = document.createElement('div');
        msgDiv.className = `dd-message ${roleClass}`;
        msgDiv.innerHTML = `
          <div class="dd-chat-avatar">${avatar}</div>
          <div class="dd-chat-bubble">${parseMarkdown(msg.content)}</div>
        `;
        chatArea.appendChild(msgDiv);
      });
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }

  async function submitChatMessage() {
    const text = chatInput.value.trim();
    if (!text || isWaitingForAi || !activeDeepDiveRepo) return;
    
    // Capture the active deep dive repo at trigger time to prevent race updates if user switches cards
    const chatRepo = activeDeepDiveRepo;
    const repoFullName = chatRepo.fullName;

    // User Message
    const userDiv = document.createElement('div');
    userDiv.className = 'dd-message user';
    userDiv.innerHTML = `
      <div class="dd-chat-avatar">👤</div>
      <div class="dd-chat-bubble">${esc(text)}</div>
    `;
    chatArea.appendChild(userDiv);
    
    chatInput.value = '';
    chatInput.style.height = 'auto';
    
    // AI Typist indicator bubble
    const aiDiv = document.createElement('div');
    aiDiv.className = 'dd-message architect dd-chat-loading';
    aiDiv.innerHTML = `
      <div class="dd-chat-avatar">🤖</div>
      <div class="dd-chat-bubble">
        <div class="dd-typing-loader">
          <span class="dd-typing-dot"></span>
          <span class="dd-typing-dot"></span>
          <span class="dd-typing-dot"></span>
        </div>
      </div>
    `;
    chatArea.appendChild(aiDiv);
    
    // Smoothly scroll to keep user's current question at the top of the container viewport
    setTimeout(() => {
      chatArea.scrollTop = userDiv.offsetTop - 12;
    }, 30);
    
    isWaitingForAi = true;
    chatHistory.push({ role: 'user', content: text });
    saveChatHistoryForRepo(repoFullName, chatHistory);

    try {
      const provider = getAiProvider();
      let model = '';
      if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
      if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
      if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
      if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
      if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;

      let apiKey = '';
      if (provider === 'groq') apiKey = getGroqApiKey();
      if (provider === 'openai') apiKey = getOpenAiKey();
      if (provider === 'anthropic') apiKey = getAnthropicKey();
      if (provider === 'gemini') apiKey = getGeminiKey();

      const reply = await chatAboutRepo(repoFullName, activeFileTree, activeReportText, chatHistory, {
        provider, apiKey, model
      });

      // Guard checks: verify if the user switched repos in the panel while loading
      if (activeDeepDiveRepo === null || activeDeepDiveRepo.fullName !== repoFullName) {
        return;
      }
      
      aiDiv.classList.remove('dd-chat-loading');
      const bubbleEl = aiDiv.querySelector('.dd-chat-bubble');
      if (bubbleEl) {
        bubbleEl.innerHTML = parseMarkdown(reply);
      }
      
      chatHistory.push({ role: 'assistant', content: reply });
      saveChatHistoryForRepo(repoFullName, chatHistory);
    } catch (chatErr) {
      if (activeDeepDiveRepo === null || activeDeepDiveRepo.fullName !== repoFullName) {
        return;
      }
      aiDiv.classList.remove('dd-chat-loading');
      aiDiv.classList.add('dd-chat-error');
      const bubbleEl = aiDiv.querySelector('.dd-chat-bubble');
      if (bubbleEl) {
        bubbleEl.innerHTML = parseMarkdown(`**Error:** ${chatErr.message}`);
      }
    } finally {
      isWaitingForAi = false;
    }
  }

  chatSend.addEventListener('click', submitChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChatMessage();
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = (chatInput.scrollHeight) + 'px';
  });

  let clearBtn = document.getElementById('dd-chat-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (activeDeepDiveRepo && confirm('Are you sure you want to clear the chat history for this repository?')) {
        clearChatHistoryForRepo(activeDeepDiveRepo.fullName);
        resetChatState();
        showToast('Chat history cleared!');
      }
    });
  }

  const resultsContainer = document.getElementById('results');
  resultsContainer.addEventListener('click', async (e) => {
    // Deep Dive
    const ddBtn = e.target.closest('[data-action="deep-dive"]');
    if (ddBtn) {
      document.getElementById('settings-modal-overlay').classList.remove('open');
      document.getElementById('bookmarks-modal-overlay').classList.remove('open');
      
      const repoFullName = ddBtn.dataset.repoName;
      const repoId = ddBtn.dataset.repoId;
      
      activeDeepDiveRepo = { fullName: repoFullName, id: repoId };
      ddTitle.textContent = `🧠 Deep Dive: ${repoFullName.split('/')[1]}`;
      ddControls.style.display = 'flex';
      
      ddModal.classList.add('open');
      
      loadChatStateForRepo(repoFullName);
      runDeepDiveGeneration(repoFullName, repoId);
    }
    
    // Find Similar circular button action
    const fsBtn = e.target.closest('[data-action="find-similar"]');
    if (fsBtn) {
      const topics = fsBtn.dataset.repoTopics.split(',').filter(Boolean);
      const lang = fsBtn.dataset.repoLang;
      // Build search interests from tags
      const newInterests = [...topics.slice(0, 3)];
      if (lang && lang !== 'Unknown' && !newInterests.includes(lang)) newInterests.push(lang);
      
      if (!newInterests.length) {
        showToast('Not enough data to find similar repos.', 'error');
        return;
      }
      
      document.getElementById('interest-input').value = newInterests.join(', ');
      currentInterests = newInterests;
      renderTags();
      updateSearchBtn();
      executeSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  const searchMoreBtn = document.getElementById('search-more-btn');
  if (searchMoreBtn) {
    searchMoreBtn.addEventListener('click', executeSearchMore);
  }
}

function exportDeepDiveToMarkdown(repoFullName) {
  const ddContent = document.getElementById('deep-dive-content');
  if (!ddContent) return;
  
  let markdown = `# Git Scout Report: ${repoFullName}\n`;
  markdown += `Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;
  
  let children = ddContent.querySelectorAll('.deep-dive-report > *');
  if (children.length === 0) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = ddContent.innerHTML;
    children = tempDiv.children;
  }
  
  Array.from(children).forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h4') {
      markdown += `\n## ${el.textContent.trim()}\n\n`;
    } else if (tag === 'p') {
      markdown += `${el.textContent.trim()}\n\n`;
    } else if (tag === 'pre' || el.classList.contains('mermaid')) {
      if (el.classList.contains('mermaid') || el.querySelector('.mermaid') || el.getAttribute('data-processed') !== null) {
        const originalCode = el.getAttribute('data-original-code') || el.textContent.trim();
        markdown += `\`\`\`mermaid\n${originalCode}\n\`\`\`\n\n`;
      } else {
        markdown += `\`\`\`\n${el.textContent.trim()}\n\`\`\`\n\n`;
      }
    } else if (tag === 'ul') {
      el.querySelectorAll('li').forEach(li => {
        markdown += `- ${li.textContent.trim()}\n`;
      });
      markdown += `\n`;
    } else if (tag === 'ol') {
      let idx = 1;
      el.querySelectorAll('li').forEach(li => {
        markdown += `${idx}. ${li.textContent.trim()}\n`;
        idx++;
      });
      markdown += `\n`;
    } else if (tag === 'div') {
      if (el.classList.contains('mermaid-container')) {
        const mEl = el.querySelector('.mermaid');
        if (mEl) {
          const originalCode = mEl.getAttribute('data-original-code') || mEl.textContent.trim();
          markdown += `\`\`\`mermaid\n${originalCode}\n\`\`\`\n\n`;
        }
      } else {
        markdown += `${el.textContent.trim()}\n\n`;
      }
    } else {
      const text = el.textContent.trim();
      if (text) {
        markdown += `${text}\n\n`;
      }
    }
  });
  
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const repoNameOnly = repoFullName.replace('/', '-');
  link.setAttribute('download', `${repoNameOnly}-scout-report.md`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Scout report exported as MD file! 📥');
}

function updateBookmarkBadge() {
  const badge = document.getElementById('bookmark-badge');
  const count = getBookmarks().length;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

function initSettingsPanel() {
  const toggle = document.getElementById('settings-toggle');
  const overlay = document.getElementById('settings-modal-overlay');
  const saveBtn = document.getElementById('save-settings');
  const closeBtn = document.getElementById('settings-close');

  const openPanel = () => {
    overlay.classList.add('open');
    document.getElementById('bookmarks-modal-overlay').classList.remove('open');
    // Only check Ollama when the settings panel is opened and Ollama is the active provider
    if (getAiProvider() === 'ollama') checkOllama();
  };
  
  const closePanel = () => overlay.classList.remove('open');

  toggle.addEventListener('click', () => {
    if (overlay.classList.contains('open')) closePanel(); else openPanel();
  });
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });
  
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  // Provider toggle
  document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const p = radio.value;
      document.getElementById('ollama-settings').style.display = p === 'ollama' ? '' : 'none';
      document.getElementById('groq-settings').style.display = p === 'groq' ? '' : 'none';
      document.getElementById('openai-settings').style.display = p === 'openai' ? '' : 'none';
      document.getElementById('anthropic-settings').style.display = p === 'anthropic' ? '' : 'none';
      document.getElementById('gemini-settings').style.display = p === 'gemini' ? '' : 'none';
      // Only check Ollama when the user selects Ollama provider
      if (p === 'ollama') checkOllama();
    });
  });

  const checkChanges = () => { saveBtn.disabled = false; };
  document.querySelectorAll('.setting-input').forEach(i => i.addEventListener('input', checkChanges));
  document.querySelectorAll('input[name="ai-provider"]').forEach(i => i.addEventListener('change', checkChanges));

  saveBtn.addEventListener('click', () => {
    const provider = document.querySelector('input[name="ai-provider"]:checked').value;
    setAiProvider(provider);
    // Saves only the selected provider's credentials to localStorage
    if (provider === 'ollama') {
      setAiModel(document.getElementById('ollama-model-input').value.trim());
    } else if (provider === 'groq') {
      setGroqApiKey(document.getElementById('groq-key-input').value);
      setGroqModel(document.getElementById('groq-model-input').value.trim());
    } else if (provider === 'openai') {
      setOpenAiKey(document.getElementById('openai-key-input').value);
      setOpenAiModel(document.getElementById('openai-model-input').value.trim());
    } else if (provider === 'anthropic') {
      setAnthropicKey(document.getElementById('anthropic-key-input').value);
      setAnthropicModel(document.getElementById('anthropic-model-input').value.trim());
    } else if (provider === 'gemini') {
      setGeminiKey(document.getElementById('gemini-key-input').value);
      setGeminiModel(document.getElementById('gemini-model-input').value.trim());
    }
    setGithubToken(document.getElementById('github-token-input').value);
    saveBtn.disabled = true;
    showToast('Settings saved!');
    closePanel();
  });

  // Test Ollama connection button
  const testOllamaBtn = document.getElementById('test-ollama-btn');
  if (testOllamaBtn) {
    testOllamaBtn.addEventListener('click', async () => {
      testOllamaBtn.disabled = true;
      testOllamaBtn.textContent = 'Testing...';
      await checkOllama();
      testOllamaBtn.disabled = false;
      testOllamaBtn.textContent = 'Test Connection';
    });
  }
}

function restoreSettings() {
  const provider = getAiProvider();
  const providerRadio = document.getElementById(`provider-${provider}`);
  if (providerRadio) providerRadio.checked = true;

  document.getElementById('ollama-settings').style.display = provider === 'ollama' ? '' : 'none';
  document.getElementById('groq-settings').style.display = provider === 'groq' ? '' : 'none';
  document.getElementById('openai-settings').style.display = provider === 'openai' ? '' : 'none';
  document.getElementById('anthropic-settings').style.display = provider === 'anthropic' ? '' : 'none';
  document.getElementById('gemini-settings').style.display = provider === 'gemini' ? '' : 'none';

  const model = getAiModel();
  if (model) document.getElementById('ollama-model-input').value = model;
  document.getElementById('groq-key-input').value = getGroqApiKey();
  document.getElementById('groq-model-input').value = getGroqModel();
  document.getElementById('openai-key-input').value = getOpenAiKey();
  document.getElementById('openai-model-input').value = getOpenAiModel();
  document.getElementById('anthropic-key-input').value = getAnthropicKey();
  document.getElementById('anthropic-model-input').value = getAnthropicModel();
  document.getElementById('gemini-key-input').value = getGeminiKey();
  document.getElementById('gemini-model-input').value = getGeminiModel();
  document.getElementById('github-token-input').value = getGithubToken();
}

async function checkOllama() {
  const statusEl = document.getElementById('ollama-status');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  text.textContent = 'Checking Ollama...';
  dot.className = 'status-dot checking';

  const status = await checkOllamaStatus();
  if (status.running) {
    dot.className = 'status-dot online';
    const models = status.models.slice(0, 5).join(', ');
    text.textContent = `Online — Models: ${models || 'none installed'}`;
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Offline — Run: ollama serve';
  }
}

function initInterestInput() {
  const input = document.getElementById('interest-input');
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      const modeEl = document.querySelector('input[name="search-mode"]:checked');
      const searchMode = modeEl ? modeEl.value : 'repo';
      if (searchMode === 'idea') {
        return; // In idea mode, let Enter proceed directly to search execution
      }
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val) addInterest(val);
    }
  });

  input.addEventListener('blur', () => {
    const modeEl = document.querySelector('input[name="search-mode"]:checked');
    const searchMode = modeEl ? modeEl.value : 'repo';
    if (searchMode === 'idea') return; // In idea mode, do not convert raw input on blur
    
    const val = input.value.trim();
    if (val) addInterest(val);
  });
  
  input.addEventListener('input', updateSearchBtn);

  // Search mode radio buttons change listener
  document.querySelectorAll('input[name="search-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      renderTags();
      updateSearchBtn();
    });
  });
}

function addInterest(text) {
  const modeEl = document.querySelector('input[name="search-mode"]:checked');
  const searchMode = modeEl ? modeEl.value : 'repo';
  if (searchMode === 'idea') return; // Do not add chips in Idea mode
  
  const clean = text.trim();
  if (clean && !currentInterests.includes(clean)) {
    currentInterests.push(clean);
    renderTags();
    document.getElementById('interest-input').value = '';
    setTimeout(updateSearchBtn, 0);
  }
}

function removeInterest(text) {
  currentInterests = currentInterests.filter(t => t !== text);
  renderTags();
  updateSearchBtn();
}

function renderTags() {
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
  wrapper.innerHTML = currentInterests.map(t => `
    <span class="interest-tag">
      ${esc(t)}
      <span class="remove" onclick="this.parentElement.remove(); window.dispatchEvent(new CustomEvent('remove-tag', { detail: '${esc(t)}' }))">&times;</span>
    </span>
  `).join('');

  const input = document.getElementById('interest-input');
  if (input) {
    if (currentInterests.length > 0) {
      input.placeholder = '';
    } else {
      input.placeholder = 'Type interest or paste GitHub URL...';
    }
  }
}

window.addEventListener('remove-tag', (e) => removeInterest(e.detail));
document.addEventListener('switch-tab', (e) => switchTab(e.detail));

function initQuickPicks() {
  const c = document.getElementById('quick-picks');
  c.innerHTML = QUICK_INTERESTS.map(t => `
    <button class="quick-chip" data-interest="${esc(t)}">+ ${esc(t)}</button>
  `).join('');
  
  c.querySelectorAll('.quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      addInterest(btn.dataset.interest);
    });
  });
  
  const showMore = document.getElementById('show-more-picks');
  showMore.addEventListener('click', () => {
    c.classList.toggle('expanded');
    showMore.textContent = c.classList.contains('expanded') ? 'Show less ▴' : 'Show more ▾';
  });
}

function initSearchButton() {
  document.getElementById('search-btn').addEventListener('click', executeSearch);
  document.getElementById('interest-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') executeSearch();
  });
}

function updateSearchBtn() { 
  const input = document.getElementById('interest-input');
  const btn = document.getElementById('search-btn');
  if (!btn) return;
  if (isSearching) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scouting...</span>`;
  } else {
    btn.removeAttribute('aria-busy');
    btn.disabled = ![...currentInterests].length && !input.value.trim();
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Scout</span>`;
  }
}

// ─── History ───
function initHistoryDropdown() {
  const btn = document.getElementById('history-btn');
  const dd = document.getElementById('history-dropdown');
  
  function renderHistoryList() {
    const h = getSearchHistory();
    if (!h.length) {
      dd.innerHTML = '<p class="history-empty">No history yet</p>';
      return;
    }
    
    dd.innerHTML = h.map((x, idx) => `
      <div class="history-item" data-index="${idx}" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <span class="history-interests" style="flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(x.interests.join(', '))}</span>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">
          <span class="history-time">${esc(new Date(x.timestamp).toLocaleDateString())}</span>
          <button class="history-item-del" data-id="${x.id}" title="Delete entry">×</button>
        </div>
      </div>
    `).join('');
    
    dd.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('history-item-del')) {
          e.stopPropagation();
          const id = e.target.dataset.id;
          removeSearchFromHistory(id);
          renderHistoryList();
          initWelcomeDashboard();
          showToast('Search history entry deleted!');
          return;
        }
        
        const idx = Number(item.dataset.index);
        const record = h[idx];
        if (record) {
          currentInterests = [...record.interests];
          renderTags();
          updateSearchBtn();
          dd.classList.remove('open');
          executeSearch();
        }
      });
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) renderHistoryList();
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !dd.contains(e.target)) {
      dd.classList.remove('open');
    }
  });
}

// ─── Bookmarks Panel UI ───
function initBookmarksPanel() {
  const btn = document.getElementById('bookmarks-btn');
  const overlay = document.getElementById('bookmarks-modal-overlay');
  const closeBtn = document.getElementById('bookmarks-close');

  const closePanel = () => overlay.classList.remove('open');
  
  btn.addEventListener('click', () => {
    document.getElementById('settings-modal-overlay').classList.remove('open');
    overlay.classList.toggle('open');
    if (overlay.classList.contains('open')) renderBookmarks();
  });
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });
  
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
}

let activeCollectionFilter = 'All';

function renderBookmarks() {
  const list = document.getElementById('bookmarks-list');
  const bm = getBookmarks();
  const collections = getCollections();

  // Filter bookmarks by the active filter
  const filteredBm = activeCollectionFilter === 'All' 
    ? bm 
    : bm.filter(r => r.collection === activeCollectionFilter);

  // Generate options for collection selectors
  const filterOptions = ['All', ...collections].map(c => 
    `<option value="${esc(c)}" ${activeCollectionFilter === c ? 'selected' : ''}>${esc(c)}</option>`
  ).join('');

  list.innerHTML = `
    <div class="collections-header">
      <div class="filter-collection-row" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
        <label for="filter-collection-select">Collection:</label>
        <select id="filter-collection-select" class="setting-input compact">${filterOptions}</select>
        ${activeCollectionFilter !== 'All' && activeCollectionFilter !== 'General' ? `
          <button class="btn btn-sm btn-outline" id="rename-collection-btn" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">✏️ Rename</button>
          <button class="btn btn-sm btn-outline" id="delete-collection-btn" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; border-color: var(--accent-red); color: var(--accent-red);">🗑️ Delete</button>
        ` : ''}
      </div>
      <div class="create-collection-row">
        <input type="text" id="new-collection-input" class="setting-input compact" placeholder="New collection name..." />
        <button class="btn btn-sm btn-primary" id="create-collection-btn">Create</button>
      </div>
    </div>
    
    <div class="bookmarks-items-list">
      ${filteredBm.length ? filteredBm.map(r => `
        <div class="bookmark-item">
          <div class="bookmark-info">
            <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="bookmark-name">${esc(r.fullName)}</a>
            <span class="bookmark-meta">⭐ ${r.stars} · ${r.language} · Score: ${r.aiScore}/10</span>
            <div class="bookmark-collection-assign">
              <label>Move: </label>
              <select class="bookmark-collection-select" data-id="${r.id}">
                ${collections.map(c => `<option value="${esc(c)}" ${r.collection === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="bookmark-remove" data-id="${r.id}" title="Remove">×</button>
        </div>
      `).join('') : (bm.length === 0
        ? '<p class="history-empty">No bookmarks yet. Click ☆ on any repo card.</p>'
        : '<p class="history-empty">No bookmarks in this collection.</p>')}
    </div>
  `;

  // Bind dropdown filter
  const filterSelect = document.getElementById('filter-collection-select');
  if (filterSelect) {
    filterSelect.addEventListener('change', (e) => {
      activeCollectionFilter = e.target.value;
      renderBookmarks();
    });
  }

  // Rename Collection
  const renameBtn = document.getElementById('rename-collection-btn');
  if (renameBtn) {
    renameBtn.addEventListener('click', () => {
      const newName = prompt('Rename collection to:', activeCollectionFilter);
      if (newName && newName.trim()) {
        const success = renameCollection(activeCollectionFilter, newName.trim());
        if (success) {
          activeCollectionFilter = newName.trim();
          renderBookmarks();
          showToast('Collection renamed!');
        } else {
          showToast('Collection name already exists or is invalid.', 'error');
        }
      }
    });
  }

  // Delete Collection
  const deleteBtn = document.getElementById('delete-collection-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete collection "${activeCollectionFilter}"? Bookmarks will be moved to General.`)) {
        deleteCollection(activeCollectionFilter);
        activeCollectionFilter = 'All';
        renderBookmarks();
        showToast('Collection deleted!');
      }
    });
  }

  // Bind dropdown moves
  list.querySelectorAll('.bookmark-collection-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      const collectionName = e.target.value;
      moveBookmarkToCollection(id, collectionName);
      renderBookmarks();
      showToast(`Moved to ${collectionName}!`);
    });
  });

  // Bind removes
  list.querySelectorAll('.bookmark-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      removeBookmark(id);
      renderBookmarks();
      document.dispatchEvent(new CustomEvent('bookmarks-updated'));
      showToast('Bookmark removed!');
    });
  });

  bindCreateCollection();
}

function bindCreateCollection() {
  const input = document.getElementById('new-collection-input');
  const btn = document.getElementById('create-collection-btn');
  if (!input || !btn) return;
  
  const createAction = () => {
    const name = input.value.trim();
    if (!name) return;
    const success = createCollection(name);
    if (success) {
      activeCollectionFilter = name;
      renderBookmarks();
      showToast(`Collection "${name}" created!`);
    } else {
      showToast('Collection already exists or name is invalid.', 'error');
    }
  };

  btn.addEventListener('click', createAction);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createAction();
  });
}

// ─── Main Execution Pipeline ───
async function executeSearch() {
  if (isSearching) return;

  const provider = getAiProvider();
  let apiKey = '';
  if (provider === 'groq') apiKey = getGroqApiKey();
  if (provider === 'openai') apiKey = getOpenAiKey();
  if (provider === 'anthropic') apiKey = getAnthropicKey();
  if (provider === 'gemini') apiKey = getGeminiKey();

  if (provider !== 'ollama' && !apiKey) {
    showToast(`Add your ${provider} API key in Settings!`, 'error');
    document.getElementById('settings-modal-overlay').classList.add('open');
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
  const searchMode = document.querySelector('input[name="search-mode"]:checked').value;

  // Auto-convert raw input to chip in keyword mode
  if (searchMode === 'repo' && inputVal) {
    if (!currentInterests.includes(inputVal)) {
      currentInterests.push(inputVal);
      renderTags();
    }
    if (input) input.value = '';
  }

  // Determine user's query/idea
  let originalIdea = '';
  if (searchMode === 'idea') {
    originalIdea = inputVal;
  } else {
    originalIdea = currentInterests.join(' ');
  }

  if (!originalIdea.trim()) {
    showToast('Please enter technical interests or an idea to search!', 'error');
    return;
  }

  isSearching = true;
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
    const cached = getCachedResults(searchMode === 'idea' ? [] : currentInterests, provider, model, searchMode, hasToken, originalIdea);
    if (cached) {
      // Safely calculate which page we are on based on cached results density
      currentPage = Math.max(2, Math.ceil(cached.length / 30));

      const dash = document.getElementById('welcome-dashboard');
      if (dash) dash.style.display = 'none';
      lastSearchedRepos = cached;
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
      
      isSearching = false;
      updateSearchBtn();
      return;
    }

    renderLoadingState(results, 'Analyzing your request...');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const dash = document.getElementById('welcome-dashboard');
    if (dash) dash.style.display = 'none';

    // Check Search Mode (Idea vs Repo)
    let searchInterests = [...currentInterests];
    
    if (searchMode === 'idea') {
      updateLoadingStep('search');
      updateLoadingMessage('Agent 2 Matchmaker: Translating idea to search keywords...');
      showToast('💡 Matchmaker is translating your idea...', 'success');
      
      let newKeywords;
      try {
        newKeywords = await translateIdeaToKeywords(originalIdea, { provider, apiKey, model });
        if (newKeywords && newKeywords.length) {
          showToast(`🔍 Searching for: ${newKeywords.join(', ')}`, 'success');
        }
      } catch (err) {
        console.warn('AI Matchmaker translation failed. Falling back to keyword mode.', err);
        newKeywords = originalIdea.split(/[\s,]+/).filter(Boolean).slice(0, 3);
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
    activeSearchInterests = searchInterests;
    const repos = await searchRepos(searchInterests, { token: getGithubToken() });
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
    const analyzed = await analyzeRepos(enriched, searchInterests, { provider, apiKey, model }, (done, total) => {
      updateProgress(50 + Math.round((done / total) * 45));
    });
    updateProgress(100);

    lastSearchedRepos = analyzed;
    renderResults(analyzed, results);
    updateResultsTabBadge(analyzed.length);

    currentPage = 2;
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
      addSearchToHistory(currentInterests, originalIdea);
      setCachedResults(currentInterests, analyzed, provider, model, searchMode, hasToken, originalIdea);
    }
    
    // Trigger live dashboard recents reload
    document.dispatchEvent(new CustomEvent('viewed-updated'));
    showToast('Search completed! 🔭');
  } catch (err) {
    console.error('executeSearch error:', err);
    renderError(results, err.message);
  } finally {
    isSearching = false;
    updateSearchBtn();
  }
}

async function executeSearchMore() {
  if (isSearching) return;
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
    document.getElementById('settings-modal-overlay').classList.add('open');
    return;
  }
  if (provider === 'ollama') {
    const status = await checkOllamaStatus();
    if (!status.running) {
      showToast('Ollama is not running! Start it with: ollama serve', 'error');
      return;
    }
  }

  isSearching = true;
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scouting Page ${currentPage + 1}...</span>`;

  try {
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;

    const token = getGithubToken();
    const nextPage = currentPage + 1;
    const searchInterests = activeSearchInterests.length ? activeSearchInterests : currentInterests;
    
    const repos = await searchRepos(searchInterests, {
      token,
      page: nextPage,
      includeTopicSearch: false
    });

    const existingIds = new Set(lastSearchedRepos.map(r => r.id));
    const uniqueNew = repos.filter(r => !existingIds.has(r.id));

    if (uniqueNew.length === 0) {
      showToast('No more new repositories found.', 'warning');
      btn.innerHTML = 'No more results';
      btn.disabled = true;
      isSearching = false;
      return;
    }

    const limit = token ? 30 : 6;
    const uniqueToEnrich = uniqueNew.slice(0, limit);

    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Enriching (0/${uniqueToEnrich.length})...</span>`;

    const enriched = await enrichRepos(uniqueToEnrich, token, (done, total) => {
      btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Enriching (${done}/${total})...</span>`;
    });

    btn.innerHTML = `<svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/></svg><span>Scoring AI cards...</span>`;

    const analyzed = await analyzeRepos(enriched, searchInterests, { provider, apiKey, model });

    lastSearchedRepos = [...lastSearchedRepos, ...analyzed];

    const searchMode = document.querySelector('input[name="search-mode"]:checked').value;
    const input = document.getElementById('interest-input');
    const originalIdea = searchMode === 'idea' ? (input ? input.value.trim() : '') : currentInterests.join(' ');
    const hasToken = !!getGithubToken();
    if (searchMode === 'idea') {
      setCachedResults([], lastSearchedRepos, provider, model, searchMode, hasToken, originalIdea);
    } else {
      setCachedResults(currentInterests, lastSearchedRepos, provider, model, searchMode, hasToken, originalIdea);
    }

    renderResults(lastSearchedRepos, document.getElementById('results'));
    scrollToResults();

    currentPage = nextPage;
    updateResultsTabBadge(lastSearchedRepos.length);

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
    isSearching = false;
  }
}

function esc(t) {
  if (!t) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHTML(htmlString) {
  // Use industry-standard DOMPurify to strip XSS vectors and clean HTML
  return DOMPurify.sanitize(htmlString, {
    ALLOWED_TAGS: ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'a', 'strong', 'em', 'i', 'b', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'target'], // Excluding 'style', 'color', etc. to prevent layout overrides
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover']
  });
}

function initNavbarScroll() {
  const nav = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (nav && window.scrollY > 20) {
      nav.classList.add('scrolled');
    } else if (nav) {
      nav.classList.remove('scrolled');
    }
  });

  // Bind Navbar brand click to redirect to Home page
  const brand = document.querySelector('.nav-brand');
  if (brand) {
    brand.addEventListener('click', () => {
      switchTab('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

function revealApp() {
  const landing = document.getElementById('landing');
  if (landing) {
    landing.classList.add('fade-out');
    setTimeout(() => {
      landing.style.display = 'none';
      document.getElementById('app-main').style.opacity = '1';
    }, 600);
  }
}



// ─── Collapsible Directory Tree Renderer ───
function renderDirectoryTreeNodes(node, depth = 0) {
  if (node.path === '') {
    return node.children.map(child => renderDirectoryTreeNodes(child, depth)).join('');
  }

  const isFolder = node.type === 'directory';
  let indentsHTML = '';
  for (let i = 0; i < depth; i++) {
    indentsHTML += '<span class="tree-indent" aria-hidden="true"></span>';
  }

  if (isFolder) {
    const childrenHTML = node.children.map(child => renderDirectoryTreeNodes(child, depth + 1)).join('');
    return `
      <div class="tree-node" role="treeitem" aria-expanded="false" tabindex="-1" data-type="directory" data-path="${esc(node.path)}">
        ${indentsHTML}
        <span class="tree-toggle" style="margin-right: 4px; width: 12px; display: inline-block;" aria-hidden="true">▸</span>
        <span class="tree-icon" aria-hidden="true">📁</span>
        <span class="tree-label">${esc(node.name)}</span>
      </div>
      <div class="tree-folder-children" role="group">
        ${childrenHTML}
      </div>
    `;
  } else {
    return `
      <div class="tree-node" role="treeitem" tabindex="-1" data-type="file" data-path="${esc(node.path)}">
        ${indentsHTML}
        <span class="tree-toggle-spacer" style="margin-right: 4px; width: 12px; display: inline-block;" aria-hidden="true"></span>
        <span class="tree-icon" aria-hidden="true">📄</span>
        <span class="tree-label">${esc(node.name)}</span>
      </div>
    `;
  }
}

function toggleFolder(node, forceState) {
  if (node.dataset.type !== 'directory') return;
  const childrenContainer = node.nextElementSibling;
  if (!childrenContainer || !childrenContainer.classList.contains('tree-folder-children')) return;
  
  const isExpanded = node.getAttribute('aria-expanded') === 'true';
  const nextState = (forceState !== undefined) ? forceState : !isExpanded;
  
  node.setAttribute('aria-expanded', String(nextState));
  const toggleSpan = node.querySelector('.tree-toggle');
  
  if (nextState) {
    childrenContainer.classList.add('expanded');
    if (toggleSpan) toggleSpan.textContent = '▾';
  } else {
    childrenContainer.classList.remove('expanded');
    if (toggleSpan) toggleSpan.textContent = '▸';
  }
}

function updateRovingTabindex(focusedNode) {
  const treeContainer = document.getElementById('deep-dive-sidebar-tree');
  if (!treeContainer) return;
  treeContainer.querySelectorAll('.tree-node').forEach(n => {
    n.setAttribute('tabindex', n === focusedNode ? '0' : '-1');
  });
}

async function triggerFullExplanation(repoFullName, filePath, thisExplainerId) {
  const drawerBody = document.getElementById('dd-detail-body');
  if (!drawerBody) return;
  
  if (fileExplainerAbortController) {
    fileExplainerAbortController.abort();
  }
  fileExplainerAbortController = new AbortController();
  const { signal } = fileExplainerAbortController;
  
  currentFileExplainerId++;
  const activeExplainerId = currentFileExplainerId;
  
  drawerBody.innerHTML = `
    <div class="loading-state-premium" style="padding: 2rem 0;">
      <div class="radar-pulse"></div>
      <div class="loading-text">
        <h4 class="gradient-text">Fetching Full File...</h4>
        <p>Retrieving entire content of ${filePath.split('/').pop()}</p>
      </div>
    </div>
  `;
  
  try {
    const token = getGithubToken();
    const defaultBranch = activeDeepDiveRepo.defaultBranch || '';
    
    // Fetch full content by passing sizeLimit = null
    const fileResult = await fetchRepoFileContent(repoFullName, filePath, token, defaultBranch, signal, null);
    if (activeExplainerId !== currentFileExplainerId) return;
    
    const fullText = fileResult.content;
    const chunkSize = 35 * 1024; // ~35KB chunk size
    const chunks = [];
    for (let i = 0; i < fullText.length; i += chunkSize) {
      chunks.push(fullText.substring(i, i + chunkSize));
    }
    
    const totalChunks = chunks.length;
    const partExplanations = [];
    
    for (let idx = 0; idx < totalChunks; idx++) {
      if (activeExplainerId !== currentFileExplainerId) return;
      
      drawerBody.innerHTML = `
        <div class="loading-state-premium" style="padding: 2rem 0;">
          <div class="radar-pulse"></div>
          <div class="loading-text">
            <h4 class="gradient-text">Explaining Parts...</h4>
            <p>Processing Part ${idx + 1} of ${totalChunks}</p>
          </div>
        </div>
      `;
      
      const provider = getAiProvider();
      let model = '';
      if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
      if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
      if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
      if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
      if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
      
      let apiKey = '';
      if (provider === 'groq') apiKey = getGroqApiKey();
      if (provider === 'openai') apiKey = getOpenAiKey();
      if (provider === 'anthropic') apiKey = getAnthropicKey();
      if (provider === 'gemini') apiKey = getGeminiKey();
      
      const chunkExplanation = await explainFileChunk(repoFullName, filePath, chunks[idx], idx + 1, totalChunks, {
        provider, apiKey, model
      }, signal);
      
      if (activeExplainerId !== currentFileExplainerId) return;
      partExplanations.push(chunkExplanation);
    }
    
    drawerBody.innerHTML = `
      <div class="loading-state-premium" style="padding: 2rem 0;">
        <div class="radar-pulse"></div>
        <div class="loading-text">
          <h4 class="gradient-text">Synthesizing Summary...</h4>
          <p>Compiling the final architectural explanation</p>
        </div>
      </div>
    `;
    
    const provider = getAiProvider();
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
    
    let apiKey = '';
    if (provider === 'groq') apiKey = getGroqApiKey();
    if (provider === 'openai') apiKey = getOpenAiKey();
    if (provider === 'anthropic') apiKey = getAnthropicKey();
    if (provider === 'gemini') apiKey = getGeminiKey();
    
    const finalSummary = await summarizeFullFile(repoFullName, filePath, partExplanations, {
      provider, apiKey, model
    }, signal);
    
    if (activeExplainerId !== currentFileExplainerId) return;
    
    const sanitizedSummary = sanitizeHTML(finalSummary);
    
    const accordionsHTML = partExplanations.map((exp, idx) => `
      <details style="margin-top: 0.75rem; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; padding: 0.5rem 0.75rem; background: rgba(255, 255, 255, 0.01);">
        <summary style="cursor: pointer; font-weight: 600; font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-cyan); outline: none;">
          Part ${idx + 1} of ${totalChunks} Explanations Details
        </summary>
        <div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
          ${sanitizeHTML(exp)}
        </div>
      </details>
    `).join('');
    
    const finalPresentationHTML = `
      <div class="full-explanation-wrapper">
        <div style="margin-bottom: 1.5rem;">
          ${sanitizedSummary}
        </div>
        <div style="border-top: 1px dashed rgba(255, 255, 255, 0.1); padding-top: 1.25rem; margin-top: 1.5rem;">
          <h5 class="gradient-text" style="font-family: var(--font-sans); font-size: 0.9rem; font-weight: 700; margin-bottom: 0.5rem;">📁 Segment Explanations (${totalChunks} parts)</h5>
          ${accordionsHTML}
        </div>
      </div>
    `;
    
    const fullCacheKey = `${repoFullName}::${filePath}::full`;
    fileExplainerCache.set(fullCacheKey, finalPresentationHTML);
    drawerBody.innerHTML = finalPresentationHTML;
  } catch (err) {
    if (activeExplainerId !== currentFileExplainerId) return;
    if (err.name === 'AbortError') return;
    console.error('Full file chunked explanation failed:', err);
    let extraTip = '';
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('TypeError'))) {
      extraTip = `<p style="margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; text-align: center;">💡 <strong>Network Tip:</strong> This is a browser connection failure. Please verify your internet connection, confirm that your AI API keys are configured, or ensure your local Ollama server is running.</p>`;
    }
    drawerBody.innerHTML = `
      <div class="error-state" style="padding: 2rem 0;">
        <div class="error-icon">⚠️</div>
        <h3>Failed to Synthesize Full File</h3>
        <p>${esc(err.message)}</p>
        ${extraTip}
      </div>
    `;
  }
}

async function handleFileSelect(filePath, node) {
  const treeContainer = document.getElementById('deep-dive-sidebar-tree');
  if (treeContainer) {
    treeContainer.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
  }
  node.classList.add('active');
  
  if (fileExplainerAbortController) {
    fileExplainerAbortController.abort();
  }
  fileExplainerAbortController = new AbortController();
  const { signal } = fileExplainerAbortController;
  
  currentFileExplainerId++;
  const thisExplainerId = currentFileExplainerId;
  
  const drawer = document.getElementById('dd-detail-drawer');
  const drawerTitle = document.getElementById('dd-detail-title');
  const drawerBody = document.getElementById('dd-detail-body');
  
  if (!drawer || !drawerTitle || !drawerBody) return;
  
  drawerTitle.textContent = filePath.split('/').pop();
  drawer.classList.add('open');
  
  drawerBody.innerHTML = `
    <div class="loading-state-premium" style="padding: 2rem 0;">
      <div class="radar-pulse"></div>
      <div class="loading-text">
        <h4 class="gradient-text">Analyzing Code...</h4>
        <p>AI is explaining ${filePath.split('/').pop()}</p>
      </div>
    </div>
  `;
  
  const repoFullName = activeDeepDiveRepo.fullName;
  const quickCacheKey = `${repoFullName}::${filePath}::quick`;
  const fullCacheKey = `${repoFullName}::${filePath}::full`;
  
  if (fileExplainerCache.has(fullCacheKey)) {
    const cachedHTML = fileExplainerCache.get(fullCacheKey);
    drawerBody.innerHTML = cachedHTML;
    return;
  }
  
  if (fileExplainerCache.has(quickCacheKey)) {
    const cachedHTML = fileExplainerCache.get(quickCacheKey);
    drawerBody.innerHTML = cachedHTML;
    
    // Bind click event to Explain Full File button if it exists
    const fullBtn = drawerBody.querySelector('.explain-full-btn');
    if (fullBtn) {
      fullBtn.onclick = () => {
        triggerFullExplanation(repoFullName, filePath, thisExplainerId);
      };
    }
    return;
  }
  
  try {
    const token = getGithubToken();
    const defaultBranch = activeDeepDiveRepo.defaultBranch || '';
    
    const fileResult = await fetchRepoFileContent(repoFullName, filePath, token, defaultBranch, signal);
    if (thisExplainerId !== currentFileExplainerId) return;
    
    const provider = getAiProvider();
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
    
    let apiKey = '';
    if (provider === 'groq') apiKey = getGroqApiKey();
    if (provider === 'openai') apiKey = getOpenAiKey();
    if (provider === 'anthropic') apiKey = getAnthropicKey();
    if (provider === 'gemini') apiKey = getGeminiKey();
    
    const explanation = await explainFileCode(repoFullName, filePath, fileResult.content, {
      provider, apiKey, model
    }, signal);
    
    if (thisExplainerId !== currentFileExplainerId) return;
    
    let formattedHTML = sanitizeHTML(explanation);
    
    if (fileResult.isTrimmed) {
      formattedHTML = `
        <div class="warning-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); color: var(--accent-amber); padding: 12px 14px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>⚠️</span>
            <div><strong>Large File Notice:</strong> This file is large. Quick Explain only read the first part.</div>
          </div>
          <button class="btn btn-sm btn-primary explain-full-btn" style="margin-top: 4px; border-radius: 100px; width: fit-content; padding: 0.4rem 1rem; font-size: 0.75rem;">Explain Full File</button>
        </div>
      ` + formattedHTML;
    }
    
    fileExplainerCache.set(quickCacheKey, formattedHTML);
    drawerBody.innerHTML = formattedHTML;
    
    // Bind click event to Explain Full File button if it exists
    const fullBtn = drawerBody.querySelector('.explain-full-btn');
    if (fullBtn) {
      fullBtn.onclick = () => {
        triggerFullExplanation(repoFullName, filePath, thisExplainerId);
      };
    }
  } catch (err) {
    if (thisExplainerId !== currentFileExplainerId) return;
    if (err.name === 'AbortError') return;
    console.error('File explanation failed:', err);
    let extraTip = '';
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('TypeError'))) {
      extraTip = `<p style="margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; text-align: center;">💡 <strong>Network Tip:</strong> This is a browser connection failure. Please verify your internet connection, confirm that your AI API keys are configured, or ensure your local Ollama server is running.</p>`;
    }
    drawerBody.innerHTML = `
      <div class="error-state" style="padding: 2rem 0;">
        <div class="error-icon">⚠️</div>
        <h3>Failed to Explain File</h3>
        <p>${esc(err.message)}</p>
        ${extraTip}
      </div>
    `;
  }
}

function bindTreeEvents(treeContainer) {
  const visibleRows = Array.from(treeContainer.querySelectorAll('.tree-node')).filter(el => el.offsetParent !== null);
  if (visibleRows[0]) {
    visibleRows[0].setAttribute('tabindex', '0');
  }
  
  treeContainer.querySelectorAll('.tree-node').forEach(node => {
    node.onclick = (e) => {
      e.stopPropagation();
      const isFolder = node.dataset.type === 'directory';
      if (isFolder) {
        toggleFolder(node);
      } else {
        handleFileSelect(node.dataset.path, node);
      }
      updateRovingTabindex(node);
    };
    
    node.onkeydown = (e) => {
      const activeRows = Array.from(treeContainer.querySelectorAll('.tree-node')).filter(el => el.offsetParent !== null);
      const currentIndex = activeRows.indexOf(node);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextRow = activeRows[currentIndex + 1] || activeRows[0];
        if (nextRow) {
          nextRow.focus();
          updateRovingTabindex(nextRow);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevRow = activeRows[currentIndex - 1] || activeRows[activeRows.length - 1];
        if (prevRow) {
          prevRow.focus();
          updateRovingTabindex(prevRow);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const isFolder = node.dataset.type === 'directory';
        const isExpanded = node.getAttribute('aria-expanded') === 'true';
        if (isFolder) {
          if (!isExpanded) {
            toggleFolder(node, true);
          } else {
            const nextRow = activeRows[currentIndex + 1];
            if (nextRow) {
              nextRow.focus();
              updateRovingTabindex(nextRow);
            }
          }
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const isFolder = node.dataset.type === 'directory';
        const isExpanded = node.getAttribute('aria-expanded') === 'true';
        if (isFolder && isExpanded) {
          toggleFolder(node, false);
        } else {
          const parentContainer = node.closest('.tree-folder-children');
          const parentRow = parentContainer?.previousElementSibling;
          if (parentRow && parentRow.classList.contains('tree-node')) {
            parentRow.focus();
            updateRovingTabindex(parentRow);
          }
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const isFolder = node.dataset.type === 'directory';
        if (isFolder) {
          toggleFolder(node);
        } else {
          handleFileSelect(node.dataset.path, node);
        }
      }
    };
  });
}

// ─── Manifest & Dependency Scanner & Explainer ───
async function scanAndRenderDependencies(repoFullName, fileTree, token, defaultBranch, signal) {
  const depsContainer = document.getElementById('deep-dive-sidebar-deps');
  if (!depsContainer) return;
  depsContainer.innerHTML = '<div class="deps-loading" style="color: var(--text-muted); font-size: 0.8rem;">Scanning manifests...</div>';
  
  const manifestPaths = fileTree.filter(p => {
    const lower = p.toLowerCase();
    return (
      lower.endsWith('package.json') ||
      lower.endsWith('requirements.txt') ||
      lower.endsWith('cargo.toml') ||
      lower.endsWith('go.mod') ||
      lower.endsWith('gemfile')
    );
  });
  
  if (manifestPaths.length === 0) {
    depsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">No build manifests detected.</div>';
    return;
  }
  
  const allDeps = [];
  
  for (const manifestPath of manifestPaths) {
    try {
      const fileName = manifestPath.split('/').pop();
      const fileResult = await fetchRepoFileContent(repoFullName, manifestPath, token, defaultBranch, signal);
      const parsed = parseManifestDependencies(fileName, fileResult.content);
      parsed.forEach(d => {
        if (!allDeps.some(existing => existing.name === d.name)) {
          allDeps.push(d);
        }
      });
    } catch (err) {
      console.warn(`Failed to fetch/parse manifest ${manifestPath}:`, err);
    }
  }
  
  if (allDeps.length === 0) {
    depsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">No dependencies parsed.</div>';
    return;
  }
  
  depsContainer.innerHTML = allDeps.map(d => `
    <button class="dep-badge" data-name="${esc(d.name)}" data-version="${esc(d.version)}" title="Version: ${esc(d.version)}">
      ${esc(d.name)} <span style="opacity: 0.5; font-size: 0.65rem; margin-left: 4px;">v${esc(d.version)}</span>
    </button>
  `).join('');
  
  depsContainer.querySelectorAll('.dep-badge').forEach(badgeEl => {
    badgeEl.onclick = () => {
      const depName = badgeEl.dataset.name;
      const version = badgeEl.dataset.version;
      handleDependencySelect(depName, version, badgeEl);
    };
  });
}

async function handleDependencySelect(depName, version, badgeEl) {
  const depsContainer = document.getElementById('deep-dive-sidebar-deps');
  if (depsContainer) {
    depsContainer.querySelectorAll('.dep-badge').forEach(b => b.classList.remove('active'));
  }
  badgeEl.classList.add('active');
  
  if (dependencyExplainerAbortController) {
    dependencyExplainerAbortController.abort();
  }
  dependencyExplainerAbortController = new AbortController();
  const { signal } = dependencyExplainerAbortController;
  
  currentDependencyExplainerId++;
  const thisExplainerId = currentDependencyExplainerId;
  
  const drawer = document.getElementById('dd-detail-drawer');
  const drawerTitle = document.getElementById('dd-detail-title');
  const drawerBody = document.getElementById('dd-detail-body');
  
  if (!drawer || !drawerTitle || !drawerBody) return;
  
  drawerTitle.textContent = `${depName} (${version})`;
  drawer.classList.add('open');
  
  drawerBody.innerHTML = `
    <div class="loading-state-premium" style="padding: 2rem 0;">
      <div class="radar-pulse"></div>
      <div class="loading-text">
        <h4 class="gradient-text">Analyzing Dependency...</h4>
        <p>AI is explaining package ${depName}</p>
      </div>
    </div>
  `;
  
  const repoFullName = activeDeepDiveRepo.fullName;
  const cacheKey = `${repoFullName}::${depName}`;
  
  if (dependencyExplainerCache.has(cacheKey)) {
    const cachedHTML = dependencyExplainerCache.get(cacheKey);
    drawerBody.innerHTML = cachedHTML;
    return;
  }
  
  try {
    const provider = getAiProvider();
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
    
    let apiKey = '';
    if (provider === 'groq') apiKey = getGroqApiKey();
    if (provider === 'openai') apiKey = getOpenAiKey();
    if (provider === 'anthropic') apiKey = getAnthropicKey();
    if (provider === 'gemini') apiKey = getGeminiKey();
    
    const explanation = await explainDependency(repoFullName, depName, version, {
      provider, apiKey, model
    }, signal);
    
    if (thisExplainerId !== currentDependencyExplainerId) return;
    
    const formattedHTML = sanitizeHTML(explanation);
    dependencyExplainerCache.set(cacheKey, formattedHTML);
    drawerBody.innerHTML = formattedHTML;
  } catch (err) {
    if (thisExplainerId !== currentDependencyExplainerId) return;
    if (err.name === 'AbortError') return;
    console.error('Dependency explanation failed:', err);
    drawerBody.innerHTML = `
      <div class="error-state" style="padding: 2rem 0;">
        <div class="error-icon">⚠️</div>
        <h3>Failed to Explain Dependency</h3>
        <p>${esc(err.message)}</p>
      </div>
    `;
  }
}

// Wire up floating detail drawer close button
document.addEventListener('DOMContentLoaded', () => {
  const detailDrawer = document.getElementById('dd-detail-drawer');
  const detailClose = document.getElementById('dd-detail-close');
  if (detailClose && detailDrawer) {
    detailClose.addEventListener('click', () => {
      detailDrawer.classList.remove('open');
      const treeContainer = document.getElementById('deep-dive-sidebar-tree');
      if (treeContainer) {
        treeContainer.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
      }
      const depsContainer = document.getElementById('deep-dive-sidebar-deps');
      if (depsContainer) {
        depsContainer.querySelectorAll('.dep-badge').forEach(b => b.classList.remove('active'));
      }
    });
  }
});
