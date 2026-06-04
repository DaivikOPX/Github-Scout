/**
 * bookmarks.js — Bookmarks drawer, custom collections management, and badges.
 */

import {
  getBookmarks,
  getCollections,
  renameCollection,
  deleteCollection,
  moveBookmarkToCollection,
  removeBookmark,
  createCollection
} from './storage.js';

import { showToast } from './ui.js';

let activeCollectionFilter = 'All';

function esc(t) {
  if (!t) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function updateBookmarkBadge() {
  const badge = document.getElementById('bookmark-badge');
  if (!badge) return;
  const count = getBookmarks().length;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

export function initBookmarksPanel() {
  const btn = document.getElementById('bookmarks-btn');
  const overlay = document.getElementById('bookmarks-modal-overlay');
  const closeBtn = document.getElementById('bookmarks-close');
  if (!btn || !overlay) return;

  const closePanel = () => overlay.classList.remove('open');
  
  btn.addEventListener('click', () => {
    const settingsOverlay = document.getElementById('settings-modal-overlay');
    if (settingsOverlay) settingsOverlay.classList.remove('open');
    overlay.classList.toggle('open');
    if (overlay.classList.contains('open')) renderBookmarks();
  });
  
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });
  
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
}

export function renderBookmarks() {
  const list = document.getElementById('bookmarks-list');
  if (!list) return;

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

// Bind custom listeners to keep badge in sync
document.addEventListener('bookmarks-updated', updateBookmarkBadge);
