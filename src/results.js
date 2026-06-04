/**
 * results.js — Render repository cards, handle pagination, filters, and comparison drawer.
 */

import {
  state,
  setCurrentPage,
  setLastSearchedRepos
} from './state.js';

import {
  isLiked,
  toggleLike,
  isBookmarked,
  addBookmark,
  removeBookmark,
  isInCompare,
  addToCompare,
  removeFromCompare,
  getCompareList,
  clearCompare,
  addViewed
} from './storage.js';

import { showToast } from './ui.js';

const REPOS_PER_PAGE = 10;

const LANG_COLORS = {
  JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',Rust:'#dea584',
  Go:'#00ADD8',Java:'#b07219','C++':'#f34b7d',C:'#555','C#':'#178600',
  Ruby:'#701516',PHP:'#4F5D95',Swift:'#F05138',Kotlin:'#A97BFF',Dart:'#00B4AB',
  Shell:'#89e051',HTML:'#e34c26',CSS:'#563d7c',R:'#198CE7',Vue:'#41b883',
};

function getScoreColor(s) {
  if (s >= 9) return '#00f5a0'; if (s >= 7) return '#00d4ff';
  if (s >= 5) return '#a78bfa'; if (s >= 3) return '#f59e0b'; return '#ef4444';
}

function formatNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k'; return ''+n;
}

function timeAgo(d) {
  if (d===0) return 'Today'; if (d===1) return 'Yesterday';
  if (d<30) return d+'d ago'; if (d<365) return Math.floor(d/30)+'mo ago';
  return Math.floor(d/365)+'y ago';
}

function esc(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusBadge(s) {
  const m = { HEALTHY:['🟢 Healthy','badge-healthy'], SICK:['🟡 Sick','badge-sick'], DEAD:['💀 Dead','badge-dead'] };
  const [l,c] = m[s]||m.HEALTHY; return `<span class="badge ${c}">${l}</span>`;
}

function safetyBadge(f, n) {
  const m = { SAFE:['🛡️ Safe','badge-safe'], CAUTION:['⚠️ Caution','badge-warning'], WARNING:['🚨 Warning','badge-danger'] };
  const [l,c] = m[f]||m.SAFE; return `<span class="badge ${c}" title="${esc(n)}">${l}</span>`;
}

function diffBadge(d) {
  const m = { Beginner:['🌱 Beginner','badge-safe'], Intermediate:['⚡ Intermediate','badge-warning'], Advanced:['🔥 Advanced','badge-danger'] };
  const [l,c] = m[d]||m.Intermediate; return `<span class="badge ${c}">${l}</span>`;
}

let _cardClickController = null; // AbortController to avoid listener stacking

export function renderRepoCard(repo, index) {
  const sc = getScoreColor(repo.aiScore);
  const lc = LANG_COLORS[repo.language]||'#888';
  const bookmarked = isBookmarked(repo.id);
  const compared = isInCompare(repo.id);
  const labelLicense = 'License';
  const labelUpdated = 'Updated';
  const labelScore = 'Score';

  const status = statusBadge(repo.maintenanceStatus);
  const diff = diffBadge(repo.difficulty);
  const liked = isLiked(repo.id);

  return `
  <article class="repo-card" style="--score-color:${sc}" data-repo-id="${repo.id}">
     <div class="card-header">
      <div class="card-title-area">
        <a href="${esc(repo.url)}" target="_blank" rel="noopener noreferrer" class="card-title">${esc(repo.name)}</a>
        <div class="card-owner">
          <img src="${esc(repo.owner.avatar)}" class="owner-avatar" loading="lazy"/>
          <span>${esc(repo.owner.name)}</span>
        </div>
      </div>
      
      <div class="score-badge-wrapper">
        <div class="score-badge" style="background:${sc}">
          <span class="score-val">${repo.aiScore}</span>
          <span class="score-label">Score</span>
        </div>
        <div class="score-breakdown-tooltip">
          <h5 class="tooltip-title">${labelScore} Breakdown</h5>
          <div class="tooltip-row"><span>Popularity:</span> <span>⭐ ${formatNum(repo.stars)}</span></div>
          <div class="tooltip-row"><span>Activity:</span> <span>🕒 ${timeAgo(repo.daysSinceUpdate)}</span></div>
          <div class="tooltip-row"><span>Health:</span> <span>${repo.maintenanceStatus}</span></div>
          <div class="tooltip-row"><span>Safety:</span> <span>${repo.safetyFlag}</span></div>
        </div>
      </div>
    </div>

    <div class="card-ai-reason">
      <span class="ai-icon">✦</span>
      ${esc(repo.aiSummary)}
    </div>

    ${repo.useCase ? `
    <div class="card-best-for">
      🎯 <strong>Best for:</strong> ${esc(repo.useCase)}
    </div>
    ` : ''}

    <div class="card-badges">
      ${repo.isHiddenGem ? '<span class="badge badge-gem">💎 Hidden Gem</span>' : ''}
      ${repo.isTrending ? '<span class="badge badge-trending">🔥 Trending</span>' : ''}
      ${status}
      ${diff}
    </div>

    <div class="card-meta-row">
      <span class="meta-item" title="Stars">⭐ ${formatNum(repo.stars)}</span>
      <span class="meta-item" title="Language"><span class="meta-lang-dot" style="background:${lc}"></span>${repo.language}</span>
      <span class="meta-item" title="${labelUpdated}">🕒 ${timeAgo(repo.daysSinceUpdate)}</span>
      <span class="meta-item" title="${labelLicense}">📄 ${esc(repo.license)}</span>
    </div>

    <!-- Premium Details Overlay -->
    <div class="card-details" id="details-${repo.id}">
      <button class="details-close" data-action="close-details" data-repo-id="${repo.id}">×</button>
      <div class="details-content">
        ${repo.aiPros && repo.aiPros.length?`<div class="report-section"><div class="report-title">✅ Pros</div><ul class="pros-list">${repo.aiPros.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}
        ${repo.aiCons && repo.aiCons.length?`<div class="report-section"><div class="report-title">⚠️ Cons</div><ul class="cons-list">${repo.aiCons.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:''}
        ${repo.starterCode?`<div class="report-section"><div class="report-title" style="display:flex; justify-content:space-between; align-items:center;"><span>💻 Quick Start</span><button class="btn btn-sm btn-outline copy-code-btn" style="padding:0.15rem 0.5rem; font-size:0.7rem; border-radius:4px;" data-code="${esc(repo.starterCode)}">Copy</button></div><pre class="starter-code">${esc(repo.starterCode)}</pre></div>`:''}
        <div class="report-section"><div class="report-title">${labelLicense}</div><p style="font-size:0.9rem;color:var(--text-secondary);">${esc(repo.license)} — ${esc(repo.safetyNote)}</p></div>
      </div>
    </div>

    <div class="card-footer-actions">
      <button class="btn-card btn-primary" data-action="deep-dive" data-repo-id="${repo.id}" data-repo-name="${esc(repo.fullName)}">
        Deep Dive
      </button>
      <a href="${esc(repo.url)}" target="_blank" rel="noopener noreferrer" class="btn-card btn-outline" data-action="view-github" data-repo-id="${repo.id}">
        GitHub ↗
      </a>
      <div class="card-icon-actions">
        <button class="btn-icon" data-action="open-details" data-repo-id="${repo.id}" title="Quick Details">
          📋
        </button>
        <button class="btn-icon" data-action="find-similar" data-repo-id="${repo.id}" data-repo-topics="${esc(repo.topics.join(','))}" data-repo-lang="${esc(repo.language)}" title="Find Similar">
          🔍
        </button>
        <button class="btn-icon ${compared?'active':''}" data-action="compare" data-repo-id="${repo.id}" title="Compare">
          ⚖️
        </button>
        <button class="btn-icon ${bookmarked?'active':''}" data-action="bookmark" data-repo-id="${repo.id}" title="Bookmark">
          ${bookmarked?'★':'☆'}
        </button>
        <button class="btn-icon ${liked?'active':''}" data-action="like" data-repo-id="${repo.id}" title="Like">
          ${liked?'❤️':'🤍'}
        </button>
      </div>
    </div>
  </article>`;
}

export function renderResults(repos, container) {
  if (!repos.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>No repositories found</h3>
      <p style="margin-top: 0.5rem; color: var(--text-muted);">Try searching: <em>machine learning, react dashboard, game engine, discord bot</em></p>
    </div>`;
    return;
  }

  const compareCount = getCompareList().length;
  const cats = [...new Set(repos.map(r=>r.aiCategory))].sort();
  const langs = [...new Set(repos.map(r=>r.language))].sort();

  let catOptions = '<option value="all">All</option>' + cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  let langOptions = '<option value="all">All</option>' + langs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');

  const sortScoreLabel = 'AI Score';
  const sortForksLabel = 'Forks';
  const sortUpdatedLabel = 'Recently Updated';

  container.innerHTML = `
    <div class="results-header">
      <button class="btn btn-outline back-btn" id="back-to-search-btn" style="padding: 0.5rem 1.2rem; font-size: 0.85rem; height: 38px;">
        ◀ Back
      </button>
      <h2 class="results-title"><span class="gradient-text">Found ${repos.length} repositories</span></h2>
    </div>
    <div class="results-layout">
      <aside class="results-sidebar">
        <button class="filters-toggle-btn" id="filters-toggle-btn">
          🎛️ Filters & Sort ▾
        </button>
        <div class="sidebar-filters" id="sidebar-filters-content">
          <div class="filter-group"><label for="sort-select">SORT</label>
            <select id="sort-select" class="control-select">
              <option value="aiScore">${sortScoreLabel}</option>
              <option value="stars">Stars</option>
              <option value="recent">${sortUpdatedLabel}</option>
              <option value="forks">${sortForksLabel}</option>
            </select>
          </div>
          <div class="filter-group"><label for="category-select">CATEGORY</label>
            <select id="category-select" class="control-select">${catOptions}</select>
          </div>
          <div class="filter-group"><label for="language-filter">LANGUAGE</label>
            <select id="language-filter" class="control-select">${langOptions}</select>
          </div>
          <div class="filter-group"><label for="status-filter">HEALTH</label>
            <select id="status-filter" class="control-select">
              <option value="all">All</option>
              <option value="HEALTHY">Healthy</option>
              <option value="SICK">Sick</option>
              <option value="DEAD">Dead</option>
            </select>
          </div>
          <div class="filter-group"><label for="diff-filter">DIFFICULTY</label>
            <select id="diff-filter" class="control-select">
              <option value="all">All</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
        </div>
        <div class="results-actions">
          <button class="btn btn-outline btn-ripple" id="export-btn">📥 Export</button>
          <button class="btn btn-outline btn-ripple" id="compare-btn">
            ⚖️ Compare <span class="compare-count">${compareCount}</span>
          </button>
        </div>
      </aside>
      <div class="results-main">
        <div class="results-grid" id="results-grid"></div>
        <div class="pagination-wrapper" id="pagination-wrapper"></div>
        <div class="compare-drawer" id="compare-drawer"></div>
      </div>
    </div>`;

  setCurrentPage(1); // Reset to page 1 on new search results render
  renderPagination(repos, container.querySelector('#pagination-wrapper'), container.querySelector('#results-grid'));

  // Bind Back to Search button click
  container.querySelector('#back-to-search-btn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'home' }));
  });

  // Collapsible mobile filters toggle binding
  const toggleBtn = container.querySelector('#filters-toggle-btn');
  const filtersContent = container.querySelector('#sidebar-filters-content');
  if (toggleBtn && filtersContent) {
    toggleBtn.addEventListener('click', () => {
      filtersContent.classList.toggle('open');
      toggleBtn.classList.toggle('active');
    });
  }

  // Filter listeners
  ['sort-select','category-select','language-filter','status-filter','diff-filter'].forEach(id => {
    container.querySelector('#'+id).addEventListener('change', () => applyFilters(repos, container));
  });

  // Export & Compare
  container.querySelector('#export-btn').addEventListener('click', () => exportResults(repos));
  container.querySelector('#compare-btn').addEventListener('click', () => showCompareDrawer(container));

  // Event delegation for card actions — abort any prior listener first
  if (_cardClickController) _cardClickController.abort();
  _cardClickController = new AbortController();
  const { signal } = _cardClickController;

  container.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-code-btn');
    if (copyBtn) {
      const code = copyBtn.dataset.code;
      const originalText = copyBtn.textContent;
      
      const onSuccess = () => {
        copyBtn.textContent = 'Copied! ✓';
        copyBtn.style.borderColor = 'var(--ok)';
        copyBtn.style.color = 'var(--ok)';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.borderColor = '';
          copyBtn.style.color = '';
        }, 2000);
        showToast('Code snippet copied to clipboard! 📋');
      };

      const copyWithFallback = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(onSuccess).catch(err => {
            console.warn('Clipboard API failed, trying fallback...', err);
            runFallback();
          });
        } else {
          runFallback();
        }
      };

      const runFallback = () => {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          if (successful) {
            onSuccess();
          } else {
            showToast('Could not copy snippet.', 'error');
          }
        } catch (err) {
          document.body.removeChild(textArea);
          console.error('Fallback copy failed:', err);
          showToast('Could not copy snippet.', 'error');
        }
      };

      copyWithFallback();
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const repoId = Number(btn.dataset.repoId);
    if (!Number.isFinite(repoId)) return;

    if (btn.dataset.action === 'open-details') {
      const detailsEl = document.getElementById(`details-${repoId}`);
      if (detailsEl) detailsEl.classList.add('open');
      return;
    }
    if (btn.dataset.action === 'close-details') {
      const detailsEl = document.getElementById(`details-${repoId}`);
      if (detailsEl) detailsEl.classList.remove('open');
      return;
    }
    if (btn.dataset.action === 'bookmark' && isBookmarked(repoId)) {
      removeBookmark(repoId);
      btn.classList.remove('active');
      btn.textContent = '☆';
      document.dispatchEvent(new CustomEvent('bookmarks-updated'));
      return;
    }

    const repo = state.lastSearchedRepos.find(r => r.id == repoId);
    if (!repo) return;

    if (btn.dataset.action === 'like') {
      const isNowLiked = toggleLike(repo);
      if (isNowLiked) { btn.classList.add('active'); btn.textContent = '❤️'; }
      else { btn.classList.remove('active'); btn.textContent = '🤍'; }
      document.dispatchEvent(new CustomEvent('bookmarks-updated'));
    }
    if (btn.dataset.action === 'view-github' || btn.dataset.action === 'deep-dive') {
      addViewed(repo);
      document.dispatchEvent(new CustomEvent('viewed-updated'));
    }
    if (btn.dataset.action === 'bookmark') {
      addBookmark(repo);
      btn.classList.add('active');
      btn.textContent = '★';
      document.dispatchEvent(new CustomEvent('bookmarks-updated'));
    }
    if (btn.dataset.action === 'compare') {
      if (isInCompare(repoId)) { removeFromCompare(repoId); btn.classList.remove('active'); }
      else {
        if (!addToCompare(repo)) { showToast('Max 4 repos can be compared at once.', 'error'); return; }
        btn.classList.add('active');
      }
      updateCompareCount(container);
    }
  }, { signal });
}

export function updateCompareCount(container) {
  const el = container.querySelector('.compare-count');
  if (el) el.textContent = getCompareList().length;
}

export function applyFilters(all, container) {
  const get = id => container.querySelector('#'+id).value;
  let f = [...all];
  const cat = get('category-select'), lang = get('language-filter'), status = get('status-filter'), diff = get('diff-filter'), sort = get('sort-select');
  if (cat !== 'all') f = f.filter(r => r.aiCategory === cat);
  if (lang !== 'all') f = f.filter(r => r.language === lang);
  if (status !== 'all') f = f.filter(r => r.maintenanceStatus === status);
  if (diff !== 'all') f = f.filter(r => r.difficulty === diff);
  f.sort((a,b) => {
    if (sort==='stars') return b.stars-a.stars;
    if (sort==='recent') return a.daysSinceUpdate-b.daysSinceUpdate;
    if (sort==='forks') return b.forks-a.forks;
    return (b.aiScore||0)-(a.aiScore||0);
  });
  setCurrentPage(1); // Reset to page 1 on filter changes
  renderPagination(f, container.querySelector('#pagination-wrapper'), container.querySelector('#results-grid'));
}

export function renderPagination(repos, wrapper, grid) {
  if (!repos.length) {
    wrapper.innerHTML = '';
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>No repos match filters</h3></div>';
    return;
  }

  const totalPages = Math.ceil(repos.length / REPOS_PER_PAGE);
  
  if (totalPages <= 1) {
    wrapper.innerHTML = '';
    grid.innerHTML = repos.map((r,i) => renderRepoCard(r,i)).join('');
    requestAnimationFrame(() => grid.querySelectorAll('.repo-card').forEach(c => c.classList.add('visible')));
    return;
  }
  
  let pageNum = state.currentPage;
  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;
  setCurrentPage(pageNum);
  
  const start = (pageNum - 1) * REPOS_PER_PAGE;
  const end = start + REPOS_PER_PAGE;
  const pageRepos = repos.slice(start, end);
  
  grid.innerHTML = pageRepos.map((r,i) => renderRepoCard(r, start + i)).join('');
  requestAnimationFrame(() => grid.querySelectorAll('.repo-card').forEach(c => c.classList.add('visible')));
  
  let pageButtonsHtml = '';
  for (let p = 1; p <= totalPages; p++) {
    pageButtonsHtml += `<button class="pagination-page-btn ${p === pageNum ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  
  wrapper.innerHTML = `
    <div class="pagination-controls-bar">
      <button class="btn-pagination-arrow" id="prev-page-btn" ${pageNum === 1 ? 'disabled' : ''}>◀ Prev</button>
      <div class="pagination-pages-list">
        ${pageButtonsHtml}
      </div>
      <button class="btn-pagination-arrow" id="next-page-btn" ${pageNum === totalPages ? 'disabled' : ''}>Next ▶</button>
    </div>
    <div class="pagination-range-info">
      Showing <strong>${start + 1}–${Math.min(end, repos.length)}</strong> of <strong>${repos.length}</strong> repositories
    </div>
  `;
  
  wrapper.querySelector('#prev-page-btn').addEventListener('click', () => {
    if (state.currentPage > 1) {
      setCurrentPage(state.currentPage - 1);
      renderPagination(repos, wrapper, grid);
      scrollToResults();
    }
  });
  
  wrapper.querySelector('#next-page-btn').addEventListener('click', () => {
    if (state.currentPage < totalPages) {
      setCurrentPage(state.currentPage + 1);
      renderPagination(repos, wrapper, grid);
      scrollToResults();
    }
  });
  
  wrapper.querySelectorAll('.pagination-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (p !== state.currentPage) {
        setCurrentPage(p);
        renderPagination(repos, wrapper, grid);
        scrollToResults();
      }
    });
  });
}

export function scrollToResults() {
  const el = document.getElementById('results');
  if (el) {
    const topOffset = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: topOffset, behavior: 'smooth' });
  }
}

export function exportResults(repos) {
  const data = repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.fullName,
    description: r.description,
    url: r.url,
    stars: r.stars,
    forks: r.forks,
    openIssues: r.openIssues,
    size: r.size,
    sizeLabel: r.sizeLabel,
    language: r.language,
    license: r.license,
    daysSinceUpdate: r.daysSinceUpdate,
    topics: r.topics,
    score: r.aiScore,
    summary: r.aiSummary,
    useCase: r.useCase,
    pros: r.aiPros,
    cons: r.aiCons,
    status: r.maintenanceStatus,
    category: r.aiCategory,
    difficulty: r.difficulty,
    safety: r.safetyFlag,
    safetyNote: r.safetyNote,
    isHiddenGem: r.isHiddenGem,
    isTrending: r.isTrending,
    starterCode: r.starterCode,
    alternatives: r.alternatives,
    avgCloseHours: r.avgCloseHours ?? r.avgResponseHours ?? null,
    readmeSnippet: r.readmeSnippet
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gitscout-results-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}

export function showCompareDrawer(container) {
  const list = getCompareList();
  const drawer = container.querySelector('#compare-drawer');
  
  if (!list.length) {
    drawer.innerHTML = `
      <div class="compare-header">
        <h3 class="gradient-text">Compare</h3>
        <button class="btn btn-sm btn-outline" id="close-empty-compare">Close</button>
      </div>
      <div class="compare-empty">
        <p>No repos selected for comparison. Click ⚖️ on cards to add.</p>
      </div>`;
    drawer.classList.add('open');
    drawer.querySelector('#close-empty-compare').addEventListener('click', () => {
      drawer.classList.remove('open');
    });
    return;
  }

  const labelScore = 'AI Score';
  const labelForks = 'Forks';
  const labelUpdated = 'Updated';
  const labelLicense = 'License';

  drawer.innerHTML = `
    <div class="compare-header">
      <h3 class="gradient-text">Compare Repositories</h3>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-sm btn-outline" id="clear-compare">Clear All</button>
        <button class="btn btn-sm btn-outline" id="close-compare">Close</button>
      </div>
    </div>
    <div class="compare-table-wrapper">
      <table class="compare-table">
        <thead><tr>
          <th>Attribute</th>${list.map(r=>`<th><a href="${r.url}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a></th>`).join('')}
        </tr></thead>
        <tbody>
          <tr><td>${labelScore}</td>${list.map(r=>`<td><strong style="color:${getScoreColor(r.aiScore)}">${r.aiScore}/10</strong></td>`).join('')}</tr>
          <tr><td>Stars</td>${list.map(r=>`<td>⭐ ${formatNum(r.stars)}</td>`).join('')}</tr>
          <tr><td>${labelForks}</td>${list.map(r=>`<td>🍴 ${formatNum(r.forks)}</td>`).join('')}</tr>
          <tr><td>Language</td>${list.map(r=>`<td>${r.language}</td>`).join('')}</tr>
          <tr><td>Health</td>${list.map(r=>`<td>${statusBadge(r.maintenanceStatus)}</td>`).join('')}</tr>
          <tr><td>Safety</td>${list.map(r=>`<td>${safetyBadge(r.safetyFlag, r.safetyNote||'')}</td>`).join('')}</tr>
          <tr><td>Difficulty</td>${list.map(r=>`<td>${diffBadge(r.difficulty)}</td>`).join('')}</tr>
          <tr><td>Size</td>${list.map(r=>`<td>${r.sizeLabel}</td>`).join('')}</tr>
          <tr><td>${labelUpdated}</td>${list.map(r=>`<td>${timeAgo(r.daysSinceUpdate)}</td>`).join('')}</tr>
          <tr><td>${labelLicense}</td>${list.map(r=>`<td>${r.license}</td>`).join('')}</tr>
          <tr><td>Summary</td>${list.map(r=>`<td class="compare-summary">${esc(r.aiSummary||'')}</td>`).join('')}</tr>
          <tr><td>Pros</td>${list.map(r=>`<td><ul class="pros-list">${(r.aiPros||[]).map(p=>`<li>${esc(p)}</li>`).join('')}</ul></td>`).join('')}</tr>
          <tr><td>Cons</td>${list.map(r=>`<td><ul class="cons-list">${(r.aiCons||[]).map(c=>`<li>${esc(c)}</li>`).join('')}</ul></td>`).join('')}</tr>
        </tbody>
      </table>
    </div>`;
  drawer.classList.add('open');
  
  drawer.querySelector('#clear-compare').addEventListener('click', () => {
    clearCompare(); drawer.classList.remove('open'); updateCompareCount(container);
    container.querySelectorAll('[data-action="compare"].active').forEach(b => b.classList.remove('active'));
  });
  
  drawer.querySelector('#close-compare').addEventListener('click', () => {
    drawer.classList.remove('open');
  });
}

// Bind custom listeners to keep UI in sync
document.addEventListener('bookmarks-updated', () => {
  const grid = document.getElementById('results-grid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.repo-card');
  cards.forEach(card => {
    const repoId = Number(card.dataset.repoId);
    if (!Number.isFinite(repoId)) return;
    const btn = card.querySelector('[data-action="bookmark"]');
    if (!btn) return;
    const bookmarked = isBookmarked(repoId);
    if (bookmarked) {
      btn.classList.add('active');
      btn.textContent = '★';
    } else {
      btn.classList.remove('active');
      btn.textContent = '☆';
    }
  });
});
