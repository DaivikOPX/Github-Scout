/**
 * state.js — Central read-only application state and its explicit setters.
 */

export const state = {
  currentTab: 'home',
  currentInterests: [],
  lastSearchedRepos: [],
  activeDeepDiveRepo: null,
  activeFileTree: [],
  activeReportText: '',
  currentDeepDiveId: 0,
  deepDiveAbortController: null,
  isSearching: false,
  currentPage: 2,
  activeSearchInterests: [],
  chatHistory: [],
  isWaitingForAi: false,

  // Explainer States
  currentFileExplainerId: 0,
  fileExplainerAbortController: null,
  fileExplainerCache: new Map(),

  currentDependencyExplainerId: 0,
  dependencyExplainerAbortController: null,
  dependencyExplainerCache: new Map()
};

// Strict Mutation Setters
export function setCurrentTab(val) {
  state.currentTab = val;
}

export function setCurrentInterests(val) {
  state.currentInterests = val;
}

export function setLastSearchedRepos(val) {
  state.lastSearchedRepos = val;
}

export function setActiveDeepDiveRepo(val) {
  state.activeDeepDiveRepo = val;
}

export function setActiveFileTree(val) {
  state.activeFileTree = val;
}

export function setActiveReportText(val) {
  state.activeReportText = val;
}

export function setCurrentDeepDiveId(val) {
  state.currentDeepDiveId = val;
}

export function incrementDeepDiveId() {
  state.currentDeepDiveId++;
  return state.currentDeepDiveId;
}

export function setDeepDiveAbortController(val) {
  state.deepDiveAbortController = val;
}

export function setIsSearching(val) {
  state.isSearching = val;
}

export function setCurrentPage(val) {
  state.currentPage = val;
}

export function setActiveSearchInterests(val) {
  state.activeSearchInterests = val;
}

export function setChatHistory(val) {
  state.chatHistory = val;
}

export function setIsWaitingForAi(val) {
  state.isWaitingForAi = val;
}

export function setCurrentFileExplainerId(val) {
  state.currentFileExplainerId = val;
}

export function incrementFileExplainerId() {
  state.currentFileExplainerId++;
  return state.currentFileExplainerId;
}

export function setFileExplainerAbortController(val) {
  state.fileExplainerAbortController = val;
}

export function setCurrentDependencyExplainerId(val) {
  state.currentDependencyExplainerId = val;
}

export function incrementDependencyExplainerId() {
  state.currentDependencyExplainerId++;
  return state.currentDependencyExplainerId;
}

export function setDependencyExplainerAbortController(val) {
  state.dependencyExplainerAbortController = val;
}
