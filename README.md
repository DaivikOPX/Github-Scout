# Git Scout 📡🧠

> A Premium AI-Powered GitHub Repository Explorer & Smart Technical Scout.

Git Scout is an ultra-premium Single Page Application (SPA) designed to help developers search, discover, compare, and perform deep architectural deep dives into public GitHub repositories. Built with a sleek Obsidian-inspired **Cyber-Aurora Theme** and powered by local (Ollama) or cloud (Groq, Gemini, OpenAI, Anthropic) AI systems, it acts as your personal Senior Systems Architect right in your browser.

---

## ⚡ Core Features

### 1. Symmetrical Discovery & Search Console
* **Scout by Keywords:** Standard search matching tags, topics, stars, and languages.
* **Idea Matchmaker:** Describe a product idea in plain natural language (e.g., *"An offline-first markdown notes app for iOS"*), and the AI will translate it into optimized GitHub search queries.
* **Centered Design Language:** Spaciously proportioned hero section with dynamic keyword suggestions, collapsible tags, and center-aligned actions.

### 2. Comprehensive Repository Details & Comparisons
* **CSS Score Badge Tooltip:** Hover over a repository's Trust Score badge to instantly review its popularity, recent maintenance activity, and licensing health in a clean, hover-activated breakdown panel.
* **Repository Comparison Drawer:** Slide open the comparison grid side-by-side to review dependencies, size, stats, and licensing differences. Includes a clear close button to dismiss the drawer while retaining selection memory.
* **Custom Collections:** Group and organize your bookmarked repositories into custom-named collections (e.g. "AI Tooling", "Web Frameworks") directly in the Bookmarks panel.

### 3. Architecture Deep Dive & "Ask Architect" Chat
* **Interactive Codebase File Tree:** Explores repository files in a nested, keyboard-navigable (`Arrow` keys, `Space`, `Enter`) structure with full ARIA accessibility.
* **Dependency Analysis & Badges:** Automatically parses package manifests (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile`) to map out and explain repository dependencies.
* **Progressive Chunking Explainer:** Explains code files of any length by chunking files into safe blocks, displaying real-time progress indicators, and synthesizing a final cohesive architectural overview.
* **Ask the Architect Chat:** Chat directly with the AI about any repository. Conversational viewports stay anchored to your active question for a natural chat flow, with persistent chat histories saved directly to your profile.

### 4. Privacy & Device-Local Storage
* **No Server Storage:** All API keys, access tokens, search history, and bookmarks are saved securely inside your browser's `localStorage`. They are kept 100% private and are never sent to any external server.
* **Persistent Settings:** Your preferred AI models and keys are saved across browser reloads so you never have to re-enter them.

---

## 🛠️ Technology Stack

* **Build Tool:** [Vite](https://vite.dev/)
* **Runtime Language:** Modern ES Modules (ES6+) Vanilla JavaScript
* **Layout and Appearance:** Custom Vanilla CSS (Obsidian Space Design System)
* **Font Layers:** Plus Jakarta Sans & Space Grotesk (from Google Fonts)
* **Graph Rendering:** Mermaid.js (via native dynamic compilation)

---

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v18 or higher) installed on your system.

### 1. Clone the repository
```bash
git clone https://github.com/DaivikOPX/Github-Scout.git
cd Github-Scout
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the development server
```bash
npm run dev
```
Open your browser and navigate to the local URL (usually `http://localhost:5173`) to launch the application.

### 4. Build for production
To compile the highly optimized HTML, JS, and CSS static bundle into the `dist/` directory:
```bash
npm run build
```

### 5. Preview production build
```bash
npm run preview
```

---

## 🧪 Running Tests

Git Scout includes an automated unit test suite verifying manifest parsing, cache key isolations, directory trees, and chunking routines.

To execute the unit tests:
```bash
npm test
```

---

## 📄 License

This project is licensed under the permissive **MIT License** — see the [LICENSE](LICENSE) file for details. Free to use, copy, modify, distribute, and commercialize with attribution.
