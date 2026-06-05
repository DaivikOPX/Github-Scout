/**
 * drawer.js — Floating side panels, collapsible directories trees, dependency scanner and AI explainer.
 */

import DOMPurify from 'dompurify';

import {
  state,
  incrementFileExplainerId,
  setFileExplainerAbortController,
  incrementDependencyExplainerId,
  setDependencyExplainerAbortController,
  setCurrentFileExplainerId,
  setCurrentDependencyExplainerId
} from './state.js';

import {
  fetchRepoFileContent,
  fetchRepoTree
} from './github.js';

import {
  explainFileCode,
  explainDependency,
  explainFileChunk,
  summarizeFullFile,
  generateRouteSpec,
  DEFAULT_MODELS
} from './ai.js';

import {
  getGithubToken,
  getAiProvider,
  getGroqApiKey,
  getOpenAiKey,
  getAnthropicKey,
  getGeminiKey,
  getAiModel,
  getGroqModel,
  getOpenAiModel,
  getAnthropicModel,
  getGeminiModel
} from './storage.js';

import {
  buildDirectoryTree,
  parseManifestDependencies,
  parseLockfileDependencies
} from './utils.js';

import { showToast } from './ui.js';

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

export function renderDirectoryTreeNodes(node, depth = 0) {
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

export function toggleFolder(node, forceState) {
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

export function updateRovingTabindex(focusedNode) {
  const treeContainer = document.getElementById('deep-dive-sidebar-tree');
  if (!treeContainer) return;
  treeContainer.querySelectorAll('.tree-node').forEach(n => {
    n.setAttribute('tabindex', n === focusedNode ? '0' : '-1');
  });
}

export async function triggerFullExplanation(repoFullName, filePath, thisExplainerId) {
  const drawerBody = document.getElementById('dd-detail-body');
  if (!drawerBody) return;
  
  if (state.fileExplainerAbortController) {
    state.fileExplainerAbortController.abort();
  }
  const fileController = new AbortController();
  setFileExplainerAbortController(fileController);
  const { signal } = fileController;
  
  const activeExplainerId = incrementFileExplainerId();
  
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
    const defaultBranch = state.activeDeepDiveRepo.defaultBranch || '';
    
    // Fetch full content by passing sizeLimit = null
    const fileResult = await fetchRepoFileContent(repoFullName, filePath, token, defaultBranch, signal, null);
    if (activeExplainerId !== state.currentFileExplainerId) return;
    
    const fullText = fileResult.content;
    const chunkSize = 35 * 1024; // ~35KB chunk size
    const chunks = [];
    for (let i = 0; i < fullText.length; i += chunkSize) {
      chunks.push(fullText.substring(i, i + chunkSize));
    }
    
    const totalChunks = chunks.length;
    const partExplanations = [];
    
    for (let idx = 0; idx < totalChunks; idx++) {
      if (activeExplainerId !== state.currentFileExplainerId) return;
      
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
      
      if (activeExplainerId !== state.currentFileExplainerId) return;
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
    
    if (activeExplainerId !== state.currentFileExplainerId) return;
    
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
    state.fileExplainerCache.set(fullCacheKey, finalPresentationHTML);
    drawerBody.innerHTML = finalPresentationHTML;
  } catch (err) {
    if (activeExplainerId !== state.currentFileExplainerId) return;
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

export async function handleFileSelect(filePath, node) {
  const treeContainer = document.getElementById('deep-dive-sidebar-tree');
  if (treeContainer) {
    treeContainer.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
  }
  node.classList.add('active');
  
  if (state.fileExplainerAbortController) {
    state.fileExplainerAbortController.abort();
  }
  const fileController = new AbortController();
  setFileExplainerAbortController(fileController);
  const { signal } = fileController;
  
  const thisExplainerId = incrementFileExplainerId();
  
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
  
  const repoFullName = state.activeDeepDiveRepo.fullName;
  const quickCacheKey = `${repoFullName}::${filePath}::quick`;
  const fullCacheKey = `${repoFullName}::${filePath}::full`;
  
  if (state.fileExplainerCache.has(fullCacheKey)) {
    const cachedHTML = state.fileExplainerCache.get(fullCacheKey);
    drawerBody.innerHTML = cachedHTML;
    return;
  }
  
  if (state.fileExplainerCache.has(quickCacheKey)) {
    const cachedHTML = state.fileExplainerCache.get(quickCacheKey);
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
    const defaultBranch = state.activeDeepDiveRepo.defaultBranch || '';
    
    const fileResult = await fetchRepoFileContent(repoFullName, filePath, token, defaultBranch, signal);
    if (thisExplainerId !== state.currentFileExplainerId) return;
    
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
    
    if (thisExplainerId !== state.currentFileExplainerId) return;
    
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
    
    state.fileExplainerCache.set(quickCacheKey, formattedHTML);
    drawerBody.innerHTML = formattedHTML;
    
    // Bind click event to Explain Full File button if it exists
    const fullBtn = drawerBody.querySelector('.explain-full-btn');
    if (fullBtn) {
      fullBtn.onclick = () => {
        triggerFullExplanation(repoFullName, filePath, thisExplainerId);
      };
    }
  } catch (err) {
    if (thisExplainerId !== state.currentFileExplainerId) return;
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

export function bindTreeEvents(treeContainer) {
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

export async function scanAndRenderDependencies(repoFullName, fileTree, token, defaultBranch, signal) {
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

export async function handleDependencySelect(depName, version, badgeEl) {
  const depsContainer = document.getElementById('deep-dive-sidebar-deps');
  if (depsContainer) {
    depsContainer.querySelectorAll('.dep-badge').forEach(b => b.classList.remove('active'));
  }
  badgeEl.classList.add('active');
  
  if (state.dependencyExplainerAbortController) {
    state.dependencyExplainerAbortController.abort();
  }
  const depController = new AbortController();
  setDependencyExplainerAbortController(depController);
  const { signal } = depController;
  
  const thisExplainerId = incrementDependencyExplainerId();
  
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
  
  const repoFullName = state.activeDeepDiveRepo.fullName;
  const cacheKey = `${repoFullName}::${depName}`;
  
  if (state.dependencyExplainerCache.has(cacheKey)) {
    const cachedHTML = state.dependencyExplainerCache.get(cacheKey);
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
    
    if (thisExplainerId !== state.currentDependencyExplainerId) return;
    
    const formattedHTML = sanitizeHTML(explanation);
    state.dependencyExplainerCache.set(cacheKey, formattedHTML);
    drawerBody.innerHTML = formattedHTML;
  } catch (err) {
    if (thisExplainerId !== state.currentDependencyExplainerId) return;
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

export function initDetailDrawer() {
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
}

/**
 * Checks dependencies against OSV public CVE database.
 */
async function checkOsvVulnerabilities(deps, ecosystem) {
  const results = {};
  const promises = deps.slice(0, 40).map(async (dep) => {
    try {
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: dep.version,
          package: { name: dep.name, ecosystem }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.vulns && data.vulns.length > 0) {
          results[dep.name] = data.vulns;
        }
      }
    } catch (e) {
      console.warn(`OSV check failed for ${dep.name}:`, e);
    }
  });
  await Promise.all(promises);
  return results;
}

/**
 * Feature 3: Dependency Graph & Safety Auditor implementation.
 */
export async function loadDeepDiveDependencies(repoFullName, fileTree, token, defaultBranch) {
  const loadingEl = document.getElementById('dd-deps-loading');
  const contentEl = document.getElementById('dd-deps-content');
  const summaryEl = document.getElementById('dd-deps-summary');
  const graphMermaid = document.getElementById('dd-deps-graph-mermaid');
  const vulnDetails = document.getElementById('dd-deps-vuln-details');
  
  if (!loadingEl || !contentEl || !summaryEl || !graphMermaid || !vulnDetails) return;
  
  loadingEl.style.display = 'block';
  contentEl.style.display = 'none';
  vulnDetails.innerHTML = 'Click on a highlighted package in the dependency tree to view CVE security advisories.';
  
  try {
    // Look for lockfiles
    let lockfilePath = fileTree.find(p => p.toLowerCase().endsWith('package-lock.json') || p.toLowerCase().endsWith('cargo.lock'));
    let nodes = {};
    let edges = [];
    let ecosystem = 'npm';
    
    if (lockfilePath) {
      const fileResult = await fetchRepoFileContent(repoFullName, lockfilePath, token, defaultBranch);
      const parsed = parseLockfileDependencies(lockfilePath.split('/').pop(), fileResult.content);
      nodes = parsed.nodes;
      edges = parsed.edges;
      if (lockfilePath.toLowerCase().endsWith('cargo.lock')) {
        ecosystem = 'crates.io';
      }
    } else {
      // Fall back to manifest parser
      const manifests = fileTree.filter(p => {
        const lower = p.toLowerCase();
        return lower.endsWith('package.json') || lower.endsWith('requirements.txt') || lower.endsWith('cargo.toml') || lower.endsWith('go.mod') || lower.endsWith('gemfile');
      });
      
      if (manifests.length > 0) {
        const manifestPath = manifests[0];
        const fileResult = await fetchRepoFileContent(repoFullName, manifestPath, token, defaultBranch);
        const fileName = manifestPath.split('/').pop();
        const parsed = parseManifestDependencies(fileName, fileResult.content);
        
        parsed.forEach(d => {
          nodes[d.name] = d.version;
        });
        
        // Setup direct connections to 'App' root
        Object.keys(nodes).forEach(depName => {
          edges.push({ from: 'App', to: depName });
        });
        
        const lower = fileName.toLowerCase();
        if (lower.endsWith('cargo.toml')) ecosystem = 'crates.io';
        else if (lower.endsWith('requirements.txt')) ecosystem = 'PyPI';
        else if (lower.endsWith('go.mod')) ecosystem = 'Go';
        else if (lower.endsWith('gemfile')) ecosystem = 'RubyGems';
      }
    }
    
    const depList = Object.entries(nodes).map(([name, version]) => ({ name, version }));
    
    if (depList.length === 0) {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
      summaryEl.innerHTML = '<span class="badge badge-safe">🟢 No Dependencies Found</span>';
      graphMermaid.textContent = 'flowchart TD\n  App["Application (No dependencies)"]';
      if (window.mermaid) {
        graphMermaid.removeAttribute('data-processed');
        await mermaid.run({ nodes: [graphMermaid] });
      }
      return;
    }
    
    // Check vulnerabilities
    const vulns = await checkOsvVulnerabilities(depList, ecosystem);
    
    // Render summary badge
    const vulnCount = Object.keys(vulns).length;
    if (vulnCount === 0) {
      summaryEl.innerHTML = `<span class="badge badge-safe" style="padding: 0.5rem 1rem; border-radius: 8px;">🟢 0 Vulnerabilities Detected</span>`;
    } else {
      summaryEl.innerHTML = `
        <span class="badge badge-danger" style="padding: 0.5rem 1rem; border-radius: 8px;">🚨 ${vulnCount} Vulnerable Packages Found</span>
        <span class="badge badge-warning" style="padding: 0.5rem 1rem; border-radius: 8px;">Audit Status: Critical Action Required</span>
      `;
    }
    
    // Compile Mermaid chart
    let mermaidCode = 'flowchart TD\n';
    const nodeIds = {};
    let nodeIdCounter = 0;
    
    if (!lockfilePath && depList.length > 0) {
      mermaidCode += '  App["App Root"]\n';
      nodeIds['App'] = 'App';
    }
    
    // Limit to 40 nodes to keep rendering neat
    const topDeps = depList.slice(0, 40);
    topDeps.forEach(dep => {
      const id = `dep_${nodeIdCounter++}`;
      nodeIds[dep.name] = id;
      mermaidCode += `  ${id}["${dep.name}<br>v${dep.version}"]\n`;
    });
    
    edges.forEach(edge => {
      const fromId = nodeIds[edge.from];
      const toId = nodeIds[edge.to];
      if (fromId && toId) {
        mermaidCode += `  ${fromId} --> ${toId}\n`;
      }
    });
    
    // Apply styling
    topDeps.forEach(dep => {
      const id = nodeIds[dep.name];
      if (vulns[dep.name]) {
        mermaidCode += `  style ${id} fill:#3b1d1d,stroke:#ef4444,color:#ff8a8a,stroke-width:2px\n`;
      } else {
        mermaidCode += `  style ${id} fill:#121829,stroke:rgba(255,255,255,0.08),color:var(--text-secondary)\n`;
      }
    });
    
    if (!lockfilePath && depList.length > 0) {
      mermaidCode += '  style App fill:#1e293b,stroke:var(--accent-cyan),color:#fff,stroke-width:2px\n';
    }
    
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    
    graphMermaid.textContent = mermaidCode;
    graphMermaid.removeAttribute('data-processed');
    
    if (window.mermaid) {
      try {
        await mermaid.run({ nodes: [graphMermaid] });
        
        // Setup click events on SVG nodes
        const svgEl = graphMermaid.querySelector('svg');
        if (svgEl) {
          const nodesList = svgEl.querySelectorAll('.node');
          nodesList.forEach(node => {
            node.style.cursor = 'pointer';
            node.onclick = () => {
              const textEl = node.querySelector('.nodeLabel') || node;
              const textContent = textEl.textContent.trim();
              // Extract package name (everything before the first 'v' or whitespace/newline)
              const pkgName = textContent.split('v')[0].replace(/[\n\r]/g, '').trim();
              
              showVulnDetails(pkgName, nodes[pkgName] || 'unknown', vulns[pkgName]);
            };
          });
        }
      } catch (mErr) {
        console.error('Mermaid dependency tree render failed:', mErr);
      }
    }
    
  } catch (err) {
    console.error('Dependency graph setup failed:', err);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    summaryEl.innerHTML = '<span class="badge badge-danger">⚠️ Graph audit failed</span>';
    graphMermaid.textContent = `flowchart TD\n  Error["Failed to parse tree: ${err.message}"]`;
    if (window.mermaid) {
      graphMermaid.removeAttribute('data-processed');
      await mermaid.run({ nodes: [graphMermaid] });
    }
  }
  
  function showVulnDetails(pkgName, version, advisories) {
    if (!advisories || advisories.length === 0) {
      vulnDetails.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
          <h5 style="color:var(--accent-green); font-size:1.05rem; font-weight:700; margin-bottom:0.25rem;">🟢 ${pkgName}</h5>
          <p><strong>Version:</strong> v${version}</p>
          <p style="color:var(--text-secondary); margin-top:0.5rem; line-height:1.4;">This package has no security advisories or vulnerabilities listed in the public OSV databases. It is safe to utilize in your production codebase.</p>
        </div>
      `;
      return;
    }
    
    const advisoriesHTML = advisories.map(adv => `
      <div style="background:rgba(239,68,68,0.04); border:1px solid rgba(239,68,68,0.15); border-radius:8px; padding:1rem; margin-bottom:1rem; display:flex; flex-direction:column; gap:0.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:var(--accent-red);">${esc(adv.id)}</span>
          <span class="badge badge-danger" style="font-size:0.65rem;">CVE Threat</span>
        </div>
        <p style="font-weight:600; margin-top:0.25rem; font-size:0.85rem; color:#fff;">${esc(adv.summary || 'Vulnerability detected')}</p>
        <p style="color:var(--text-secondary); font-size:0.8rem; line-height:1.4; margin-top:0.25rem;">${esc(adv.details || 'No additional details provided.')}</p>
        ${adv.references && adv.references.length ? `
          <div style="margin-top:0.5rem;">
            <strong style="font-size:0.75rem; color:var(--text-muted);">Links & References:</strong>
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px;">
              ${adv.references.slice(0, 3).map(ref => `
                <a href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem; color:var(--accent-cyan); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  ${esc(ref.url)} ↗
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `).join('');
    
    vulnDetails.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <h5 style="color:var(--accent-red); font-size:1.05rem; font-weight:700; margin-bottom:0.25rem;">🚨 ${pkgName}</h5>
        <p><strong>Version:</strong> v${version}</p>
        <div style="margin-top:1rem;">
          ${advisoriesHTML}
        </div>
      </div>
    `;
  }
}

/**
 * Feature 4: API Spec Explorer & REST Console Client implementation.
 */
export async function loadDeepDiveApiSpec(repoFullName, fileTree, token, defaultBranch) {
  const loadingEl = document.getElementById('dd-api-loading');
  const contentEl = document.getElementById('dd-api-content');
  const routeListEl = document.getElementById('dd-api-route-list');
  const testerEl = document.getElementById('dd-api-tester');
  
  if (!loadingEl || !contentEl || !routeListEl || !testerEl) return;
  
  loadingEl.style.display = 'block';
  contentEl.style.display = 'none';
  testerEl.innerHTML = `
    <div style="color: var(--text-muted); text-align: center; padding: 3rem 1rem;">
      <div style="font-size: 2rem; margin-bottom: 1rem;">📡</div>
      <h5>REST Client Console</h5>
      <p style="font-size: 0.85rem;">Select an API endpoint from the route list to run mock execution requests.</p>
    </div>
  `;
  
  try {
    // Scan for route definitions
    const routingFiles = fileTree.filter(p => {
      const lower = p.toLowerCase();
      return (
        lower.includes('/routes/') ||
        lower.includes('/api/') ||
        lower.includes('router') ||
        lower.endsWith('views.py') ||
        lower.endsWith('urls.py') ||
        lower.includes('controllers/') ||
        lower.endsWith('routes.js')
      );
    }).slice(0, 10);
    
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
    
    const spec = await generateRouteSpec(repoFullName, routingFiles, { provider, apiKey, model });
    
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    
    if (spec.length === 0) {
      routeListEl.innerHTML = '<div style="color:var(--text-muted); padding:1rem; text-align:center;">No API endpoints detected.</div>';
      return;
    }
    
    // Render route list
    routeListEl.innerHTML = `
      <h5 style="font-size:0.95rem; font-weight:700; color:var(--text-secondary); margin-bottom:0.5rem; padding-left:4px;">Endpoints (${spec.length})</h5>
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        ${spec.map((route, idx) => {
          const method = (route.method || 'GET').toUpperCase();
          let color = '#00f5a0'; // green
          if (method === 'POST') color = '#00d4ff'; // blue
          if (method === 'PUT') color = '#f59e0b'; // amber
          if (method === 'DELETE') color = '#ef4444'; // red
          
          return `
            <button class="api-route-btn" data-index="${idx}" style="display:flex; flex-direction:column; align-items:flex-start; text-align:left; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); padding:0.75rem 1rem; border-radius:8px; cursor:pointer; width:100%; transition:all 0.2s;">
              <div style="display:flex; align-items:center; gap:8px; width:100%;">
                <span style="font-family:var(--font-mono); font-size:0.7rem; font-weight:700; padding:0.1rem 0.4rem; border-radius:4px; border:1px solid ${color}; color:${color}; min-width:48px; text-align:center;">${method}</span>
                <span style="font-family:var(--font-mono); font-size:0.8rem; font-weight:600; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${esc(route.path)}</span>
              </div>
              <span style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem; line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${esc(route.description)}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
    
    // Bind click events to route buttons
    routeListEl.querySelectorAll('.api-route-btn').forEach(btn => {
      btn.onclick = () => {
        routeListEl.querySelectorAll('.api-route-btn').forEach(b => {
          b.style.borderColor = 'rgba(255,255,255,0.05)';
          b.style.background = 'rgba(255,255,255,0.02)';
        });
        btn.style.borderColor = 'var(--accent-cyan)';
        btn.style.background = 'rgba(0, 245, 160, 0.02)';
        
        const idx = Number(btn.dataset.index);
        renderApiTester(spec[idx]);
      };
    });
    
  } catch (err) {
    console.error('API Explorer scan failed:', err);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    routeListEl.innerHTML = `<div style="color:var(--accent-red); padding:1rem; text-align:center;">⚠️ Spec generation failed.</div>`;
  }
  
  function renderApiTester(route) {
    const method = (route.method || 'GET').toUpperCase();
    let methodColor = '#00f5a0';
    if (method === 'POST') methodColor = '#00d4ff';
    if (method === 'PUT') methodColor = '#f59e0b';
    if (method === 'DELETE') methodColor = '#ef4444';
    
    const params = route.params || [];
    
    let paramsFieldsHTML = '';
    if (params.length > 0) {
      paramsFieldsHTML = `
        <div style="margin-top:1.25rem;">
          <h6 style="font-size:0.85rem; font-weight:700; margin-bottom:0.75rem; color:var(--text-secondary);">Request Parameters</h6>
          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            ${params.map(p => `
              <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:0.75rem; font-weight:600; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                  <span>${esc(p.name)}</span>
                  <span style="font-size:0.6rem; color:var(--text-muted); opacity:0.8;">(${esc(p.type)}${p.required ? ' • required' : ''})</span>
                </label>
                <input class="tester-param-input" data-name="${esc(p.name)}" data-type="${esc(p.type)}" type="text" placeholder="${esc(p.description || '')}" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); padding:0.5rem 0.75rem; border-radius:6px; color:#fff; font-size:0.8rem; width:100%; outline:none;" />
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    // Add request body JSON textfield for POST/PUT if no specific body params
    let bodyJsonHTML = '';
    if ((method === 'POST' || method === 'PUT') && !params.some(p => p.type === 'body')) {
      bodyJsonHTML = `
        <div style="margin-top:1.25rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:4px;">Request Body (JSON)</label>
          <textarea id="tester-body-json" placeholder="{}" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); padding:0.5rem 0.75rem; border-radius:6px; color:#fff; font-size:0.8rem; width:100%; height:80px; font-family:var(--font-mono); outline:none; resize:vertical;"></textarea>
        </div>
      `;
    }
    
    testerEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:1.25rem; height:100%;">
        <div style="border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.75rem; display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h5 style="font-size:1rem; font-weight:700; color:#fff; margin-bottom:0.25rem;">REST API execution Client</h5>
            <p style="font-size:0.75rem; color:var(--text-muted);">${esc(route.description)}</p>
          </div>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:8px;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--text-secondary);">Server Base URL</label>
          <div style="display:flex; gap:0.5rem; width:100%;">
            <input id="tester-base-url" type="text" value="http://localhost:3000" style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); padding:0.5rem 0.75rem; border-radius:6px; color:#fff; font-size:0.8rem; width:180px; outline:none;" />
            <div style="display:flex; flex:1; font-family:var(--font-mono); background:rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.05); padding:0.5rem 0.75rem; border-radius:6px; font-size:0.8rem; align-items:center; overflow:hidden;">
              <span style="color:${methodColor}; font-weight:700; margin-right:8px; font-size:0.7rem; border:1px solid ${methodColor}; padding:0.05rem 0.25rem; border-radius:3px;">${method}</span>
              <span style="color:rgba(255,255,255,0.85); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" id="tester-compiled-path">${esc(route.path)}</span>
            </div>
          </div>
        </div>
        
        ${paramsFieldsHTML}
        ${bodyJsonHTML}
        
        <button id="tester-execute-btn" class="btn btn-primary" style="padding:0.6rem 1.2rem; font-size:0.8rem; font-weight:600; border-radius:8px; cursor:pointer; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;">
          🚀 Execute Mock Request
        </button>
        
        <div style="display:flex; flex-direction:column; gap:6px; flex:1; min-height:180px; margin-top:0.75rem;">
          <label style="font-size:0.75rem; font-weight:600; color:var(--text-secondary); display:flex; justify-content:space-between;">
            <span>Response Results</span>
            <span id="tester-response-status" style="font-family:var(--font-mono); font-size:0.7rem;"></span>
          </label>
          <pre id="tester-response-output" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:1rem; color:var(--text-secondary); font-family:var(--font-mono); font-size:0.75rem; overflow:auto; flex:1; max-height:280px; margin:0; line-height:1.4;">Waiting for request execution...</pre>
        </div>
      </div>
    `;
    
    // Bind interactive parameter updates to compiled path
    const baseInput = testerEl.querySelector('#tester-base-url');
    const paramInputs = testerEl.querySelectorAll('.tester-param-input');
    const compiledPathEl = testerEl.querySelector('#tester-compiled-path');
    
    function updateCompiledPath() {
      let path = route.path;
      // path param substitution
      paramInputs.forEach(input => {
        if (input.dataset.type === 'path') {
          const val = input.value.trim() || `:${input.dataset.name}`;
          path = path.replace(`:${input.dataset.name}`, val).replace(`{${input.dataset.name}}`, val);
        }
      });
      
      // query param suffix
      const queries = [];
      paramInputs.forEach(input => {
        if (input.dataset.type === 'query' && input.value.trim()) {
          queries.push(`${encodeURIComponent(input.dataset.name)}=${encodeURIComponent(input.value.trim())}`);
        }
      });
      if (queries.length > 0) {
        path += `?${queries.join('&')}`;
      }
      
      compiledPathEl.textContent = path;
    }
    
    paramInputs.forEach(input => {
      input.oninput = updateCompiledPath;
    });
    
    // Bind execution
    const executeBtn = testerEl.querySelector('#tester-execute-btn');
    const statusEl = testerEl.querySelector('#tester-response-status');
    const outputEl = testerEl.querySelector('#tester-response-output');
    
    executeBtn.onclick = async () => {
      executeBtn.disabled = true;
      executeBtn.textContent = 'Executing...';
      statusEl.textContent = '';
      outputEl.textContent = 'Executing network request...';
      outputEl.style.color = 'var(--text-secondary)';
      
      const baseUrl = baseInput.value.trim() || 'http://localhost:3000';
      const path = compiledPathEl.textContent;
      const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
      
      const fetchOpts = {
        method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      };
      
      // Build request body
      if (method === 'POST' || method === 'PUT') {
        const bodyParams = {};
        paramInputs.forEach(input => {
          if (input.dataset.type === 'body' && input.value.trim()) {
            bodyParams[input.dataset.name] = input.value.trim();
          }
        });
        
        const textfield = testerEl.querySelector('#tester-body-json');
        if (textfield && textfield.value.trim()) {
          try {
            fetchOpts.body = JSON.stringify(JSON.parse(textfield.value.trim()));
          } catch (e) {
            outputEl.textContent = `❌ Request Body JSON Parse Error: ${e.message}`;
            outputEl.style.color = 'var(--accent-red)';
            executeBtn.disabled = false;
            executeBtn.textContent = '🚀 Execute Mock Request';
            return;
          }
        } else if (Object.keys(bodyParams).length > 0) {
          fetchOpts.body = JSON.stringify(bodyParams);
        }
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
      fetchOpts.signal = controller.signal;
      
      try {
        const res = await fetch(url, fetchOpts);
        clearTimeout(timeoutId);
        
        statusEl.textContent = `HTTP ${res.status} ${res.statusText}`;
        if (res.ok) {
          statusEl.style.color = 'var(--accent-green)';
        } else {
          statusEl.style.color = 'var(--accent-red)';
        }
        
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          outputEl.textContent = JSON.stringify(json, null, 2);
        } catch {
          outputEl.textContent = text || '[Empty Response]';
        }
      } catch (err) {
        clearTimeout(timeoutId);
        statusEl.textContent = 'ERROR';
        statusEl.style.color = 'var(--accent-red)';
        
        if (err.name === 'AbortError') {
          outputEl.textContent = '❌ Request Timed Out (8000ms). The local or staging server is unresponsive.';
        } else {
          outputEl.textContent = `❌ Fetch Query Failed.\n\nDetails: ${err.message}\n\nNote: This is likely a CORS blocking issue (Cross-Origin Resource Sharing) or because your local server on "${baseUrl}" is offline. Verify your local server terminal is running and listening on the specified port.`;
        }
        outputEl.style.color = 'var(--accent-red)';
      } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = '🚀 Execute Mock Request';
      }
    };
  }
}
