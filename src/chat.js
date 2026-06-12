/**
 * chat.js — Follow-up interactive Architect Chat module.
 */

import {
  state,
  setChatHistory,
  setIsWaitingForAi
} from './state.js';

import {
  getChatHistoryForRepo,
  saveChatHistoryForRepo,
  clearChatHistoryForRepo,
  getAiProvider,
  getGroqApiKey,
  getOpenAiKey,
  getAnthropicKey,
  getGeminiKey,
  getGrokKey,
  getHfKey,
  getOpenrouterKey,
  getAiModel,
  getGroqModel,
  getOpenAiModel,
  getAnthropicModel,
  getGeminiModel,
  getGrokModel,
  getHfModel,
  getOpenrouterModel,
  getGithubToken,
  getRepoChunks,
  saveRepoChunks
} from './storage.js';

import { chatAboutRepo, DEFAULT_MODELS } from './ai.js';
import { parseMarkdown, computeTfidfSimilarity, chunkFileContent } from './utils.js';
import { showToast } from './ui.js';
import { fetchRepoFileContent } from './github.js';

function esc(t) {
  if (!t) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function resetChatState() {
  const chatArea = document.getElementById('dd-chat-messages');
  const chatInput = document.getElementById('dd-chat-input');
  if (!chatArea) return;

  setChatHistory([]);
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

export function loadChatStateForRepo(repoFullName) {
  resetChatState();
  const history = getChatHistoryForRepo(repoFullName);
  const chatArea = document.getElementById('dd-chat-messages');
  if (!chatArea) return;

  if (history.length > 0) {
    setChatHistory(history);
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

export async function submitChatMessage() {
  const chatInput = document.getElementById('dd-chat-input');
  const chatArea = document.getElementById('dd-chat-messages');
  if (!chatInput || !chatArea) return;

  const text = chatInput.value.trim();
  if (!text || state.isWaitingForAi || !state.activeDeepDiveRepo) return;
  
  // Capture the active deep dive repo at trigger time to prevent race updates if user switches cards
  const chatRepo = state.activeDeepDiveRepo;
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
  
  setIsWaitingForAi(true);
  const nextHistory = [...state.chatHistory, { role: 'user', content: text }];
  setChatHistory(nextHistory);
  saveChatHistoryForRepo(repoFullName, nextHistory);

  try {
    const provider = getAiProvider();
    let model = '';
    if (provider === 'ollama') model = getAiModel() || DEFAULT_MODELS.ollama;
    if (provider === 'groq') model = getGroqModel() || DEFAULT_MODELS.groq;
    if (provider === 'openai') model = getOpenAiModel() || DEFAULT_MODELS.openai;
    if (provider === 'anthropic') model = getAnthropicModel() || DEFAULT_MODELS.anthropic;
    if (provider === 'gemini') model = getGeminiModel() || DEFAULT_MODELS.gemini;
    if (provider === 'grok') model = getGrokModel() || DEFAULT_MODELS.grok;
    if (provider === 'huggingface') model = getHfModel() || DEFAULT_MODELS.huggingface;
    if (provider === 'openrouter') model = getOpenrouterModel() || DEFAULT_MODELS.openrouter;

    let apiKey = '';
    if (provider === 'groq') apiKey = getGroqApiKey();
    if (provider === 'openai') apiKey = getOpenAiKey();
    if (provider === 'anthropic') apiKey = getAnthropicKey();
    if (provider === 'gemini') apiKey = getGeminiKey();
    if (provider === 'grok') apiKey = getGrokKey();
    if (provider === 'huggingface') apiKey = getHfKey();
    if (provider === 'openrouter') apiKey = getOpenrouterKey();

    // Query Cached Codebase Chunks from IndexedDB
    const chunks = await getRepoChunks(repoFullName);
    const relevantChunks = computeTfidfSimilarity(text, chunks, 4); // Fetch top 4 code segments

    const reply = await chatAboutRepo(repoFullName, state.activeFileTree, state.activeReportText, nextHistory, {
      provider, apiKey, model, codeChunks: relevantChunks
    });

    // Guard checks: verify if the user switched repos in the panel while loading
    if (state.activeDeepDiveRepo === null || state.activeDeepDiveRepo.fullName !== repoFullName) {
      return;
    }
    
    aiDiv.classList.remove('dd-chat-loading');
    const bubbleEl = aiDiv.querySelector('.dd-chat-bubble');
    if (bubbleEl) {
      bubbleEl.innerHTML = parseMarkdown(reply);
    }
    
    const finalHistory = [...nextHistory, { role: 'assistant', content: reply }];
    setChatHistory(finalHistory);
    saveChatHistoryForRepo(repoFullName, finalHistory);
  } catch (chatErr) {
    if (state.activeDeepDiveRepo === null || state.activeDeepDiveRepo.fullName !== repoFullName) {
      return;
    }
    aiDiv.classList.remove('dd-chat-loading');
    aiDiv.classList.add('dd-chat-error');
    const bubbleEl = aiDiv.querySelector('.dd-chat-bubble');
    if (bubbleEl) {
      bubbleEl.innerHTML = parseMarkdown(`**Error:** ${chatErr.message}`);
    }
  } finally {
    setIsWaitingForAi(false);
  }
}

export function initChatSystem() {
  const chatInput = document.getElementById('dd-chat-input');
  const chatSend = document.getElementById('dd-chat-send');
  if (chatSend) chatSend.addEventListener('click', submitChatMessage);
  
  if (chatInput) {
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
  }

  const clearBtn = document.getElementById('dd-chat-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (state.activeDeepDiveRepo && confirm('Are you sure you want to clear the chat history for this repository?')) {
        clearChatHistoryForRepo(state.activeDeepDiveRepo.fullName);
        resetChatState();
        showToast('Chat history cleared!');
      }
    });
  }
}

/**
 * Background repository indexer that downloads primary source files,
 * splits them into overlapping semantic text segments, and caches them in IndexedDB.
 */
export async function indexRepoCodebaseInBackground(repoFullName, fileTree) {
  try {
    const cached = await getRepoChunks(repoFullName);
    if (cached && cached.length > 0) {
      console.log(`[Indexer] Codebase for ${repoFullName} already cached in IndexedDB.`);
      return;
    }

    console.log(`[Indexer] Starting background indexing for ${repoFullName}...`);
    
    // Filter for primary business logic source files
    const SUPPORTED_EXTS = ['.js', '.ts', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.cs', '.rb', '.php', '.html', '.css'];
    const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', 'vendor', '.git', 'target', 'assets', 'images'];

    const filteredPaths = fileTree.filter(p => {
      const lower = p.toLowerCase();
      const hasExt = SUPPORTED_EXTS.some(ext => lower.endsWith(ext));
      const inExcluded = EXCLUDED_DIRS.some(dir => lower.includes(`/${dir}/`) || lower.startsWith(`${dir}/`));
      const isLockfile = lower.endsWith('-lock.json') || lower.endsWith('.lock') || lower.endsWith('-lock.yaml');
      return hasExt && !inExcluded && !isLockfile;
    }).slice(0, 15); // Index up to 15 key source files to stay safe on rate limits

    if (filteredPaths.length === 0) {
      console.log('[Indexer] No primary source files found to index.');
      return;
    }

    const token = getGithubToken();
    const allChunks = [];

    for (const filePath of filteredPaths) {
      try {
        const fileData = await fetchRepoFileContent(repoFullName, filePath, token, 15000); // 15KB max per file
        if (fileData && fileData.content) {
          const fileChunks = chunkFileContent(filePath, fileData.content, 800, 150);
          allChunks.push(...fileChunks);
        }
      } catch (err) {
        console.warn(`[Indexer] Failed to index file: ${filePath}`, err);
      }
      // Delay to avoid hitting rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    if (allChunks.length > 0) {
      await saveRepoChunks(repoFullName, allChunks);
      console.log(`[Indexer] Codebase indexing complete for ${repoFullName}. Chunks: ${allChunks.length}`);
      showToast('⚡ Repository codebase successfully indexed for Ask Architect!', 'success');
    }
  } catch (err) {
    console.error('[Indexer] Indexing failed:', err);
  }
}

