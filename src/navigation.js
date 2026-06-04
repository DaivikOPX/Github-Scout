/**
 * navigation.js — Tab navigation and routing logic.
 */

import { state, setCurrentTab } from './state.js';

export function switchTab(tabId) {
  // If attempting to switch to results but there are no results loaded, redirect to home
  if (tabId === 'results') {
    const resultsContainer = document.getElementById('results');
    if (!resultsContainer || resultsContainer.children.length === 0 || resultsContainer.style.display === 'none') {
      if (!state.isSearching) {
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

  setCurrentTab(tabId);
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Update hash to support browser back button navigation
  if (window.location.hash.slice(1) !== tabId) {
    window.location.hash = tabId;
  }
}

// Global browser Back/Forward navigation event listener
window.addEventListener('hashchange', () => {
  const tabId = window.location.hash.slice(1) || 'home';
  if (['home', 'results', 'deep-dive'].includes(tabId)) {
    const pane = document.getElementById('pane-' + tabId);
    if (pane && pane.style.display !== 'block') {
      switchTab(tabId);
    }
  }
});

export function initTabKeyboardNavigation() {
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

export function initNavbarScroll() {
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

// Add a custom listener to allow switching tabs via events
document.addEventListener('switch-tab', (e) => switchTab(e.detail));
