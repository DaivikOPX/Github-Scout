/**
 * main.js — Simplified app entry bootstrapper with initialization error boundary.
 */

import './style.css';
import DOMPurify from 'dompurify';
import { fetchRepoIssues, fetchRepoTree } from './src/github.js';
import { generateDeepDive, checkOllamaStatus, DEFAULT_MODELS } from './src/ai.js';
import { renderLoadingState, updateLoadingMessage, updateProgress, renderError, showToast, updateLoadingStep } from './src/ui.js';
import { renderResults, scrollToResults } from './src/results.js';
import {
  getGroqApiKey, setGroqApiKey, getGithubToken, setGithubToken, getGroqModel, setGroqModel,
  getOpenAiKey, setOpenAiKey, getAnthropicKey, setAnthropicKey, getGeminiKey, setGeminiKey,
  getOpenAiModel, setOpenAiModel, getAnthropicModel, setAnthropicModel, getGeminiModel, setGeminiModel,
  getAiProvider, setAiProvider, getAiModel, setAiModel,
  getSearchHistory, removeSearchFromHistory,
  getBookmarks, getLikes, getViewed, getCompareList
} from './src/storage.js';

import { buildDirectoryTree } from './src/utils.js';

// State Mutators
import {
  state,
  setCurrentInterests,
  setLastSearchedRepos,
  setActiveDeepDiveRepo,
  setActiveFileTree,
  setActiveReportText,
  incrementDeepDiveId,
  setDeepDiveAbortController,
  setIsSearching,
  setCurrentPage
} from './src/state.js';

// Navigation Module
import { initNavbarScroll, initTabKeyboardNavigation, switchTab } from './src/navigation.js';

// Search Module
import {
  renderTags,
  updateSearchBtn,
  initInterestInput,
  initQuickPicks,
  initSearchButton,
  initRotatingText,
  initBackToTop,
  initKeyboardShortcuts,
  executeSearch,
  executeSearchMore,
  updateResultsTabBadge
} from './src/search.js';

// Bookmarks Module
import { initBookmarksPanel, updateBookmarkBadge } from './src/bookmarks.js';

// Chat Module
import { initChatSystem, loadChatStateForRepo, resetChatState, indexRepoCodebaseInBackground } from './src/chat.js';

// Drawer Module
import {
  renderDirectoryTreeNodes,
  bindTreeEvents,
  scanAndRenderDependencies,
  initDetailDrawer,
  loadDeepDiveDependencies,
  loadDeepDiveApiSpec
} from './src/drawer.js';

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
  return DOMPurify.sanitize(htmlString, {
    ALLOWED_TAGS: ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'a', 'strong', 'em', 'i', 'b', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'target'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover']
  });
}

function formatNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k'; return ''+n;
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
    initChatSystem();
    initDetailDrawer();
    initDeepDiveTabs();

    // Catch storage failure events decoupled from storage layer
    window.addEventListener('localstorage-failure', (e) => {
      showToast('⚠️ Storage limit reached! Please clear some bookmarks or history to save new data.', 'error');
    });
  } catch (err) {
    console.error('Initialization error:', err);
    // Display a clean recovery modal on launch failures
    const appMain = document.getElementById('app-main');
    if (appMain) {
      appMain.innerHTML = `
        <div class="error-boundary-modal" style="position: fixed; inset: 0; background: rgba(10, 15, 30, 0.95); display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 2rem;">
          <div style="background: var(--bg-card, #111a2e); border: 1px solid rgba(255, 255, 255, 0.05); padding: 2.5rem; border-radius: 12px; max-width: 500px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
            <h3 class="gradient-text" style="font-size: 1.5rem; margin-bottom: 0.75rem;">Git Scout Failed to Launch</h3>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5;">A critical component failed to initialize during startup. Please clear your cache and refresh the dashboard.</p>
            <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 6px; text-align: left; font-family: monospace; font-size: 0.8rem; overflow-x: auto; color: var(--accent-red); margin-bottom: 1.5rem; border: 1px solid rgba(239, 68, 68, 0.1);">
              ${err.stack || err.message || err}
            </div>
            <button class="btn btn-primary" onclick="location.reload()" style="width: 100%;">↻ Reload Application</button>
          </div>
        </div>
      `;
    }
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
              const input = document.getElementById('interest-input');
              if (input) {
                input.value = item.originalIdea;
                input.dispatchEvent(new Event('input'));
              }
              setCurrentInterests([]);
            } else {
              const radioRepo = document.querySelector('input[name="search-mode"][value="repo"]');
              if (radioRepo) radioRepo.checked = true;
              const input = document.getElementById('interest-input');
              if (input) {
                input.value = '';
                input.dispatchEvent(new Event('input'));
              }
              setCurrentInterests([...item.interests]);
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
            setActiveDeepDiveRepo({ fullName: repo.fullName, id: repo.id });
            const settingsOverlay = document.getElementById('settings-modal-overlay');
            if (settingsOverlay) settingsOverlay.classList.remove('open');
            const bookmarksOverlay = document.getElementById('bookmarks-modal-overlay');
            if (bookmarksOverlay) bookmarksOverlay.classList.remove('open');
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
            setActiveDeepDiveRepo({ fullName: repo.fullName, id: repo.id });
            const settingsOverlay = document.getElementById('settings-modal-overlay');
            if (settingsOverlay) settingsOverlay.classList.remove('open');
            const bookmarksOverlay = document.getElementById('bookmarks-modal-overlay');
            if (bookmarksOverlay) bookmarksOverlay.classList.remove('open');
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

function initResultsActions() {
  const ddModal = document.getElementById('deep-dive-modal-overlay');
  const ddClose = document.getElementById('deep-dive-close');
  const ddTitle = document.getElementById('deep-dive-title');
  const ddControls = document.getElementById('deep-dive-controls');
  
  function abortDeepDive() {
    if (state.deepDiveAbortController) {
      state.deepDiveAbortController.abort();
      setDeepDiveAbortController(null);
    }
    // Safely make any older active generation ticks return early
    incrementDeepDiveId();
  }

  if (ddClose) {
    ddClose.addEventListener('click', () => {
      if (ddModal) ddModal.classList.remove('open');
      abortDeepDive();
    });
  }
  if (ddModal) {
    ddModal.addEventListener('click', (e) => {
      if (e.target === ddModal) {
        ddModal.classList.remove('open');
        abortDeepDive();
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ddModal && ddModal.classList.contains('open')) {
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
  
  const refreshBtn = document.getElementById('deep-dive-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (state.activeDeepDiveRepo) {
        resetChatState();
        runDeepDiveGeneration(state.activeDeepDiveRepo.fullName, state.activeDeepDiveRepo.id);
      }
    });
  }

  const exportBtn = document.getElementById('deep-dive-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (state.activeDeepDiveRepo) exportDeepDiveToMarkdown(state.activeDeepDiveRepo.fullName);
    });
  }

  const resultsContainer = document.getElementById('results');
  if (resultsContainer) {
    resultsContainer.addEventListener('click', async (e) => {
      // Deep Dive
      const ddBtn = e.target.closest('[data-action="deep-dive"]');
      if (ddBtn) {
        const settingsOverlay = document.getElementById('settings-modal-overlay');
        if (settingsOverlay) settingsOverlay.classList.remove('open');
        const bookmarksOverlay = document.getElementById('bookmarks-modal-overlay');
        if (bookmarksOverlay) bookmarksOverlay.classList.remove('open');
        
        setActiveDeepDiveRepo({ fullName: repoFullName, id: repoId });
        if (ddTitle) ddTitle.textContent = `🧠 Deep Dive: ${repoFullName.split('/')[1]}`;
        if (ddControls) ddControls.style.display = 'flex';
        
        // Reset tabs to default (Report)
        document.querySelectorAll('#deep-dive-modal .dd-tab-btn').forEach(btn => {
          btn.classList.toggle('active', btn.id === 'dd-tab-report');
        });
        document.querySelectorAll('#deep-dive-modal .dd-pane').forEach(pane => {
          const isReport = pane.id === 'dd-pane-report';
          pane.style.display = isReport ? '' : 'none';
          pane.classList.toggle('active', isReport);
        });
        
        if (ddModal) ddModal.classList.add('open');
        
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
        
        const inputVal = document.getElementById('interest-input');
        if (inputVal) {
          inputVal.value = newInterests.join(', ');
          inputVal.dispatchEvent(new Event('input'));
        }
        setCurrentInterests(newInterests);
        renderTags();
        updateSearchBtn();
        executeSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

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

async function runDeepDiveGeneration(repoFullName, repoId) {
  const thisDeepDiveId = incrementDeepDiveId();

  if (state.deepDiveAbortController) {
    state.deepDiveAbortController.abort();
  }
  const diveController = new AbortController();
  setDeepDiveAbortController(diveController);
  const { signal } = diveController;

  const statsEl = document.getElementById('deep-dive-sidebar-stats');
  const healthEl = document.getElementById('deep-dive-sidebar-health');
  const ddContent = document.getElementById('deep-dive-content');
  
  // Premium Shimmer Loading
  const shimmer = '<div class="shimmer" style="height:12px; width:80%; margin-bottom:10px; border-radius:4px;"></div>' + 
                 '<div class="shimmer" style="height:12px; width:60%; margin-bottom:10px; border-radius:4px;"></div>' +
                 '<div class="shimmer" style="height:12px; width:70%; border-radius:4px;"></div>';
  
  if (ddContent) {
    ddContent.innerHTML = `
      <div class="loading-state-premium">
        <div class="radar-pulse"></div>
        <div class="loading-text">
          <h3 class="gradient-text">Orchestrating Agents...</h3>
          <p>Architect & Teacher are mapping the codebase</p>
        </div>
      </div>
    `;
  }
  if (statsEl) statsEl.innerHTML = shimmer;
  if (healthEl) healthEl.innerHTML = shimmer;
  
  try {
    const token = getGithubToken();
    const issues = await fetchRepoIssues(repoFullName, token, signal);
    if (thisDeepDiveId !== state.currentDeepDiveId) return;
    
    const repoIdNum = Number(repoId);
    let repo = null;
    if (Number.isFinite(repoIdNum)) {
      repo = state.lastSearchedRepos.find(r => r.id == repoIdNum) ||
             getBookmarks().find(r => r.id == repoIdNum) ||
             getLikes().find(r => r.id == repoIdNum) ||
             getViewed().find(r => r.id == repoIdNum) ||
             getCompareList().find(r => r.id == repoIdNum);
    }
    if (!repo && repoFullName) {
      repo = state.lastSearchedRepos.find(r => r.fullName === repoFullName) ||
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
    if (thisDeepDiveId !== state.currentDeepDiveId) return;
    setActiveFileTree(tree);
    
    if (tree.length) {
      indexRepoCodebaseInBackground(repoFullName, tree);
    }
    
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
    if (repo && statsEl) {
      statsEl.innerHTML = `
        <div class="dash-list">
          <div class="dash-item"><span class="dash-item-title">⭐ Stars:</span> ${formatNum(repo.stars || 0)}</div>
          <div class="dash-item"><span class="dash-item-title">🍴 Forks:</span> ${formatNum(repo.forks || 0)}</div>
          <div class="dash-item"><span class="dash-item-title">📅 Created:</span> ${repo.createdAt ? new Date(repo.createdAt).toLocaleDateString() : 'Unknown'}</div>
          <div class="dash-item"><span class="dash-item-title">📦 Size:</span> ${repo.sizeLabel || 'Unknown'}</div>
          <div class="dash-item"><span class="dash-item-title">📄 License:</span> ${repo.license || 'None'}</div>
        </div>
      `;
    } else if (statsEl) {
      statsEl.innerHTML = `
        <div class="dash-list">
          <div class="dash-item"><span class="dash-item-title">⭐ Stars:</span> Unknown</div>
          <div class="dash-item"><span class="dash-item-title">🍴 Forks:</span> Unknown</div>
          <div class="dash-item"><span class="dash-item-title">📅 Created:</span> Unknown</div>
          <div class="dash-item"><span class="dash-item-title">📦 Size:</span> Unknown</div>
          <div class="dash-item"><span class="dash-item-title">📄 License:</span> Unknown</div>
        </div>
      `;
    }

    if (healthEl) {
      const bugs = issues.filter(i => i.isBug).length;
      if (repo) {
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
      const ddModalOverlay = document.getElementById('deep-dive-modal-overlay');
      if (ddModalOverlay) ddModalOverlay.classList.remove('open');
      abortDeepDive();
      const settingsOverlay = document.getElementById('settings-modal-overlay');
      if (settingsOverlay) settingsOverlay.classList.add('open');
      throw new Error(`${provider} API key required`);
    }

    const slider = document.getElementById('deep-dive-slider');
    const diffVal = slider ? slider.value : '2';
    const difficulty = diffVal === '1' ? 'Beginner' : diffVal === '3' ? 'Advanced' : 'Intermediate';
    const langEl = document.getElementById('deep-dive-lang');
    const translateTarget = langEl ? langEl.value : '';

    const report = await generateDeepDive(repoFullName, tree, issues, {
      provider, apiKey, model, difficulty, translateTarget, signal
    });
    if (thisDeepDiveId !== state.currentDeepDiveId) return;
    setActiveReportText(report);
    
    let reportHTML = report;
    if (tree.isTruncated) {
      reportHTML = `
        <div class="warning-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); color: var(--accent-amber); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 0.85rem; display: flex; align-items: center; gap: 10px;">
          <span>⚠️</span>
          <div><strong>Large Repository Notice:</strong> The file tree is extremely large and was truncated for optimal analysis and visualization performance.</div>
        </div>
      ` + reportHTML;
    }
    if (ddContent) ddContent.innerHTML = sanitizeHTML(reportHTML);

    // Render Mermaid Flowchart Blueprint
    if (window.mermaid && ddContent) {
      try {
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
    if (thisDeepDiveId !== state.currentDeepDiveId) return;
    console.error('Deep dive generation failed:', err);
    if (ddContent) {
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
      const settingsBtn = ddContent.querySelector('#dd-open-settings');
      if (settingsBtn) settingsBtn.addEventListener('click', () => {
        const ddModalOverlay = document.getElementById('deep-dive-modal-overlay');
        if (ddModalOverlay) ddModalOverlay.classList.remove('open');
        abortDeepDive();
        const settingsOverlay = document.getElementById('settings-modal-overlay');
        if (settingsOverlay) settingsOverlay.classList.add('open');
      });
      const retryBtn = ddContent.querySelector('#dd-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        runDeepDiveGeneration(repoFullName, repoId);
      });
    }
  }
}

function initSettingsPanel() {
  const toggle = document.getElementById('settings-toggle');
  const overlay = document.getElementById('settings-modal-overlay');
  const saveBtn = document.getElementById('save-settings');
  const closeBtn = document.getElementById('settings-close');

  const openPanel = () => {
    if (overlay) overlay.classList.add('open');
    const bookmarksOverlay = document.getElementById('bookmarks-modal-overlay');
    if (bookmarksOverlay) bookmarksOverlay.classList.remove('open');
    if (getAiProvider() === 'ollama') checkOllama();
  };
  
  const closePanel = () => { if (overlay) overlay.classList.remove('open'); };

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (overlay && overlay.classList.contains('open')) closePanel(); else openPanel();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });
  }
  
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const p = radio.value;
      const ollamaSet = document.getElementById('ollama-settings');
      const groqSet = document.getElementById('groq-settings');
      const openaiSet = document.getElementById('openai-settings');
      const anthropicSet = document.getElementById('anthropic-settings');
      const geminiSet = document.getElementById('gemini-settings');
      
      if (ollamaSet) ollamaSet.style.display = p === 'ollama' ? '' : 'none';
      if (groqSet) groqSet.style.display = p === 'groq' ? '' : 'none';
      if (openaiSet) openaiSet.style.display = p === 'openai' ? '' : 'none';
      if (anthropicSet) anthropicSet.style.display = p === 'anthropic' ? '' : 'none';
      if (geminiSet) geminiSet.style.display = p === 'gemini' ? '' : 'none';
      
      if (p === 'ollama') checkOllama();
    });
  });

  const checkChanges = () => { if (saveBtn) saveBtn.disabled = false; };
  document.querySelectorAll('.setting-input').forEach(i => i.addEventListener('input', checkChanges));
  document.querySelectorAll('input[name="ai-provider"]').forEach(i => i.addEventListener('change', checkChanges));

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const providerRadio = document.querySelector('input[name="ai-provider"]:checked');
      if (!providerRadio) return;
      const provider = providerRadio.value;
      setAiProvider(provider);
      if (provider === 'ollama') {
        const oModel = document.getElementById('ollama-model-input');
        if (oModel) setAiModel(oModel.value.trim());
      } else if (provider === 'groq') {
        const gKey = document.getElementById('groq-key-input');
        const gModel = document.getElementById('groq-model-input');
        if (gKey) setGroqApiKey(gKey.value);
        if (gModel) setGroqModel(gModel.value.trim());
      } else if (provider === 'openai') {
        const oKey = document.getElementById('openai-key-input');
        const oModel = document.getElementById('openai-model-input');
        if (oKey) setOpenAiKey(oKey.value);
        if (oModel) setOpenAiModel(oModel.value.trim());
      } else if (provider === 'anthropic') {
        const aKey = document.getElementById('anthropic-key-input');
        const aModel = document.getElementById('anthropic-model-input');
        if (aKey) setAnthropicKey(aKey.value);
        if (aModel) setAnthropicModel(aModel.value.trim());
      } else if (provider === 'gemini') {
        const gemKey = document.getElementById('gemini-key-input');
        const gemModel = document.getElementById('gemini-model-input');
        if (gemKey) setGeminiKey(gemKey.value);
        if (gemModel) setGeminiModel(gemModel.value.trim());
      }
      const ghToken = document.getElementById('github-token-input');
      if (ghToken) setGithubToken(ghToken.value);
      
      saveBtn.disabled = true;
      showToast('Settings saved!');
      closePanel();
    });
  }

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

  const ollamaSet = document.getElementById('ollama-settings');
  const groqSet = document.getElementById('groq-settings');
  const openaiSet = document.getElementById('openai-settings');
  const anthropicSet = document.getElementById('anthropic-settings');
  const geminiSet = document.getElementById('gemini-settings');

  if (ollamaSet) ollamaSet.style.display = provider === 'ollama' ? '' : 'none';
  if (groqSet) groqSet.style.display = provider === 'groq' ? '' : 'none';
  if (openaiSet) openaiSet.style.display = provider === 'openai' ? '' : 'none';
  if (anthropicSet) anthropicSet.style.display = provider === 'anthropic' ? '' : 'none';
  if (geminiSet) geminiSet.style.display = provider === 'gemini' ? '' : 'none';

  const model = getAiModel();
  const oModelInput = document.getElementById('ollama-model-input');
  if (model && oModelInput) oModelInput.value = model;
  
  const groqKeyInput = document.getElementById('groq-key-input');
  if (groqKeyInput) groqKeyInput.value = getGroqApiKey();
  const groqModelInput = document.getElementById('groq-model-input');
  if (groqModelInput) groqModelInput.value = getGroqModel();
  
  const openaiKeyInput = document.getElementById('openai-key-input');
  if (openaiKeyInput) openaiKeyInput.value = getOpenAiKey();
  const openaiModelInput = document.getElementById('openai-model-input');
  if (openaiModelInput) openaiModelInput.value = getOpenAiModel();
  
  const anthropicKeyInput = document.getElementById('anthropic-key-input');
  if (anthropicKeyInput) anthropicKeyInput.value = getAnthropicKey();
  const anthropicModelInput = document.getElementById('anthropic-model-input');
  if (anthropicModelInput) anthropicModelInput.value = getAnthropicModel();
  
  const geminiKeyInput = document.getElementById('gemini-key-input');
  if (geminiKeyInput) geminiKeyInput.value = getGeminiKey();
  const geminiModelInput = document.getElementById('gemini-model-input');
  if (geminiModelInput) geminiModelInput.value = getGeminiModel();
  
  const ghTokenInput = document.getElementById('github-token-input');
  if (ghTokenInput) ghTokenInput.value = getGithubToken();
}

async function checkOllama() {
  const statusEl = document.getElementById('ollama-status');
  if (!statusEl) return;
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  if (text) text.textContent = 'Checking Ollama...';
  if (dot) dot.className = 'status-dot checking';

  const status = await checkOllamaStatus();
  if (status.running) {
    if (dot) dot.className = 'status-dot online';
    const models = status.models.slice(0, 5).join(', ');
    if (text) text.textContent = `Online — Models: ${models || 'none installed'}`;
  } else {
    if (dot) dot.className = 'status-dot offline';
    if (text) text.textContent = 'Offline — Run: ollama serve';
  }
}

// ─── Search History Dropdown UI ───
function initHistoryDropdown() {
  const btn = document.getElementById('history-btn');
  const dd = document.getElementById('history-dropdown');
  if (!btn || !dd) return;
  
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
          setCurrentInterests([...record.interests]);
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

function initDeepDiveTabs() {
  const tabs = document.querySelectorAll('#deep-dive-modal .dd-tab-btn');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const paneId = tab.dataset.pane;
      const panes = document.querySelectorAll('#deep-dive-modal .dd-pane');
      panes.forEach(pane => {
        const isTarget = pane.id === paneId;
        pane.classList.toggle('active', isTarget);
        pane.style.display = isTarget ? '' : 'none';
      });
      
      const repoFullName = state.activeDeepDiveRepo ? state.activeDeepDiveRepo.fullName : '';
      const token = getGithubToken();
      const defaultBranch = state.activeDeepDiveRepo ? (state.activeDeepDiveRepo.defaultBranch || 'main') : 'main';
      
      if (paneId === 'dd-pane-deps' && repoFullName) {
        loadDeepDiveDependencies(repoFullName, state.activeFileTree, token, defaultBranch);
      } else if (paneId === 'dd-pane-api' && repoFullName) {
        loadDeepDiveApiSpec(repoFullName, state.activeFileTree, token, defaultBranch);
      }
    };
  });
}
