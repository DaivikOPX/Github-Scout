/**
 * ui.js — Shared loading states, steps indicators, errors, and toast systems.
 */

function esc(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let loadingFactInterval = null;

export function renderLoadingState(container, msg='Searching...') {
  if (loadingFactInterval) {
    clearInterval(loadingFactInterval);
    loadingFactInterval = null;
  }

  const facts = [
    "The first GitHub PR was merged on Jan 14, 2008.",
    "GitHub was founded in 2008 in San Francisco, California.",
    "The octocat mascot, designed by Simon Oxley, was originally named Octopuss.",
    "Linus Torvalds created Git in 2005 to manage Linux kernel development.",
    "GitHub reached 100 million repositories in November 2018.",
    "The first commit on GitHub was created on October 19, 2007.",
    "The most popular repository on GitHub by star count is freeCodeCamp.",
    "GitHub's code vaults in Svalbard, Norway, are designed to store open-source code for 1,000 years.",
    "The term 'fork' in Git refers to copying a repository to make changes without affecting the original.",
    "Git's name is British slang for an unpleasant or stupid person—Linus Torvalds jokingly named it after himself."
  ];

  // Select a random starting fact
  let currentFactIndex = Math.floor(Math.random() * facts.length);
  const initialFact = facts[currentFactIndex];

  container.innerHTML = `
    <div class="loading-state">
      <div class="stepper" id="loading-stepper">
        <div class="step active" id="step-search"><div class="step-icon">🔍</div><div class="step-label">Search</div></div>
        <div class="step" id="step-enrich"><div class="step-icon">📡</div><div class="step-label">Enrich</div></div>
        <div class="step" id="step-analyze"><div class="step-icon">🤖</div><div class="step-label">Analyze</div></div>
      </div>
      <div class="loader-container">
        <div class="radar-loader"><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-dot"></div></div>
      </div>
      <p class="loading-message" id="loading-message">${esc(msg)}</p>
      <div class="loading-progress"><div class="progress-bar" id="progress-bar"></div></div>
      <p id="loading-fact" style="margin-top:1.5rem;font-size:0.75rem;color:var(--text-muted);font-style:italic;transition: opacity 0.3s ease; height: 1.2rem; display: flex; align-items: center; justify-content: center;">${esc(initialFact)}</p>
    </div>`;

  loadingFactInterval = setInterval(() => {
    const factEl = document.getElementById('loading-fact');
    if (factEl) {
      let nextIndex;
      do {
        nextIndex = Math.floor(Math.random() * facts.length);
      } while (nextIndex === currentFactIndex);
      currentFactIndex = nextIndex;

      // Fade out, change text, fade in for ultra-premium UX
      factEl.style.opacity = '0';
      setTimeout(() => {
        factEl.textContent = facts[nextIndex];
        factEl.style.opacity = '1';
      }, 300);
    }
  }, 5000);
}

export function updateLoadingStep(stepName) {
  const stepper = document.getElementById('loading-stepper');
  if (!stepper) return;
  const steps = ['search', 'enrich', 'analyze'];
  let found = false;
  steps.forEach(s => {
    const el = document.getElementById('step-' + s);
    if (!el) return;
    if (s === stepName) { el.className = 'step active'; found = true; }
    else if (!found) { el.className = 'step done'; }
    else { el.className = 'step'; }
  });
}

export function updateLoadingMessage(m) {
  const e = document.getElementById('loading-message');
  if (e) e.textContent = m;
}

export function updateProgress(p) {
  const b = document.getElementById('progress-bar');
  if (b) b.style.width = p + '%';
}

export function renderError(container, msg) {
  if (loadingFactInterval) {
    clearInterval(loadingFactInterval);
    loadingFactInterval = null;
  }
  container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><h3>Something went wrong</h3><p>${esc(msg)}</p><button class="btn btn-primary btn-ripple" onclick="location.reload()">Try Again</button></div>`;
}

export function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✅' : '⚠️'}</div>
    <div class="toast-msg">${esc(msg)}</div>
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => t.remove(), 400);
  }, 3500);
}
