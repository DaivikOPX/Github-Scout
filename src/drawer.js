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
  parseManifestDependencies
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
