// Frontend Snipper UI Controller (Injected via Content Script)

(function () {
  // Overwrite UI functions to bind to current script context on injection/reload
  // Immediately purge any orphaned sidebar container from a previous script context
  const existingContainer = document.getElementById('frontend-snipper-sidebar-root');
  if (existingContainer) {
    existingContainer.remove();
  }

  let sidebarRoot = null;
  let shadowRoot = null;
  let isInspectActive = false;
  let snippedHtml = '';
  let snippedCss = '';
  let activeTab = 'html'; // 'html' or 'css'
  let currentTagName = '';
  let activeMode = 'element'; // 'element' or 'fullpage'

  // Core CSS for Shadow DOM UI
  const shadowStyles = `
    :host {
      all: initial;
      font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .panel-container {
      width: 100%;
      height: 100%;
      background-color: rgba(10, 11, 15, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      color: #E2E8F0;
      display: flex;
      flex-direction: column;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
      box-shadow: -10px 0 40px rgba(0, 0, 0, 0.5);
    }

    /* Header */
    .panel-header {
      padding: 18px 20px;
      background-color: rgba(16, 18, 27, 0.8);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: transparent;
      border-radius: 6px;
      overflow: hidden;
    }

    .logo-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .logo-text {
      font-weight: 800;
      font-size: 14px;
      color: #FFFFFF;
      letter-spacing: 0.8px;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    .logo-accent {
      background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #A0AEC0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .close-btn:hover {
      color: #FFFFFF;
      background-color: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.4);
      transform: rotate(90deg);
    }

    /* Content Area */
    .panel-content {
      flex: 1;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      position: relative;
    }

    /* Mode Selector */
    .mode-selector {
      display: flex;
      background-color: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 4px;
      border-radius: 10px;
      gap: 4px;
    }

    .mode-tab {
      flex: 1;
      background: none;
      border: none;
      color: #718096;
      padding: 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .mode-tab svg {
      width: 14px;
      height: 14px;
      transition: stroke 0.25s;
    }

    .mode-tab:hover:not(.active) {
      color: #E2E8F0;
      background-color: rgba(255, 255, 255, 0.03);
    }

    .mode-tab.active {
      background-color: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: #00F2FE;
    }

    /* Controls */
    .control-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .btn-action {
      position: relative;
      background: linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(79, 172, 254, 0.08) 100%);
      border: 1px solid rgba(0, 242, 254, 0.25);
      color: #00F2FE;
      padding: 14px 20px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      letter-spacing: 0.5px;
      overflow: hidden;
    }

    .btn-action::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
      transition: left 0.5s;
    }

    .btn-action:hover::before {
      left: 100%;
    }

    .btn-action:hover {
      background: linear-gradient(135deg, rgba(0, 242, 254, 0.18) 0%, rgba(79, 172, 254, 0.18) 100%);
      box-shadow: 0 0 16px rgba(0, 242, 254, 0.25);
      transform: translateY(-1px);
    }

    .btn-action:active {
      transform: translateY(1px);
    }

    .btn-action.active {
      background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      color: #0A0B0F;
      border-color: transparent;
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.4);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0px rgba(0, 242, 254, 0.5);
      }
      70% {
        box-shadow: 0 0 0 8px rgba(0, 242, 254, 0);
      }
      100% {
        box-shadow: 0 0 0 0px rgba(0, 242, 254, 0);
      }
    }

    /* Info text below mode controls */
    .mode-desc {
      font-size: 11.5px;
      color: #718096;
      line-height: 1.5;
      text-align: center;
      padding: 0 10px;
    }

    /* Empty State */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 40px 24px;
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      text-align: center;
      color: #A0AEC0;
      background-color: rgba(0, 0, 0, 0.15);
    }

    .empty-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 60px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: #4A5568;
    }

    .empty-icon-svg {
      width: 28px;
      height: 28px;
    }

    .empty-title {
      font-size: 14px;
      font-weight: 700;
      color: #FFFFFF;
    }

    .empty-text {
      font-size: 12px;
      line-height: 1.6;
      max-width: 250px;
    }

    /* Code Preview Section */
    .preview-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 0;
    }

    .preview-meta-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .meta-tag-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .meta-tag-badge {
      background: rgba(0, 242, 254, 0.1);
      color: #00F2FE;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      font-weight: 600;
    }

    .meta-details {
      font-size: 11px;
      color: #718096;
      font-weight: 500;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .tabs {
      display: flex;
      background-color: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 3px;
      border-radius: 8px;
      gap: 2px;
    }

    .tab {
      background: none;
      border: none;
      color: #718096;
      padding: 6px 16px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .tab:hover:not(.active) {
      color: #E2E8F0;
    }

    .tab.active {
      background-color: rgba(255, 255, 255, 0.08);
      color: #00F2FE;
    }

    .code-container {
      flex: 1;
      background-color: #0A0B0F;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .code-area {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      background-color: transparent;
      color: #CBD5E0;
      font-family: 'Fira Code', 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.6;
      padding: 16px;
      resize: none;
      outline: none;
      white-space: pre;
      overflow: auto;
    }

    .btn-copy {
      position: absolute;
      top: 10px;
      right: 10px;
      background-color: rgba(16, 18, 27, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #A0AEC0;
      padding: 6px 12px;
      font-size: 10px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
    }

    .btn-copy svg {
      width: 12px;
      height: 12px;
    }

    .btn-copy:hover {
      background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      color: #0A0B0F;
      border-color: transparent;
    }

    .btn-copy.success {
      background: #10B981 !important;
      color: #FFFFFF !important;
      border-color: transparent !important;
    }

    /* Footer */
    .panel-footer {
      padding: 20px;
      background-color: rgba(16, 18, 27, 0.8);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .btn-download {
      position: relative;
      background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      color: #0A0B0F;
      border: none;
      padding: 14px 20px;
      font-size: 13px;
      font-weight: 800;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      letter-spacing: 0.5px;
      box-shadow: 0 4px 15px rgba(0, 242, 254, 0.2);
    }

    .btn-download:hover:not(:disabled) {
      box-shadow: 0 6px 20px rgba(0, 242, 254, 0.35);
      transform: translateY(-1px);
    }

    .btn-download:active:not(:disabled) {
      transform: translateY(1px);
    }

    .btn-download:disabled {
      background: rgba(255, 255, 255, 0.04) !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      color: #4A5568 !important;
      cursor: not-allowed;
      box-shadow: none !important;
      transform: none !important;
    }

    /* Loading Overlay styling */
    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(10, 11, 15, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .loading-overlay.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .spinner {
      width: 42px;
      height: 42px;
      border: 3px solid rgba(0, 242, 254, 0.1);
      border-top: 3px solid #00F2FE;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      box-shadow: 0 0 10px rgba(0, 242, 254, 0.15);
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 13px;
      font-weight: 700;
      color: #E2E8F0;
      letter-spacing: 0.5px;
    }

    .loading-subtext {
      font-size: 11px;
      color: #718096;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  `;

  // HTML content of the panel
  const panelHtml = `
    <div class="panel-container">
      <div class="panel-header">
        <div class="brand">
          <div class="logo-container">
            <img class="logo-img" id="fs-logo-img" alt="Frontend Snipper Logo" />
          </div>
          <div class="logo-text">FRONTEND <span class="logo-accent">SNIPPER</span></div>
        </div>
        <button class="close-btn" id="fs-close" title="Close Panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="panel-content">
        <!-- Loading Overlay -->
        <div class="loading-overlay" id="fs-loading-overlay">
          <div class="spinner"></div>
          <div class="loading-text">Analyzing DOM Tree</div>
          <div class="loading-subtext">Extracting computed styles and layout...</div>
        </div>

        <!-- Mode Selector -->
        <div class="mode-selector">
          <button class="mode-tab active" id="fs-mode-element">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Element Mode</span>
          </button>
          <button class="mode-tab" id="fs-mode-fullpage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>Full Page</span>
          </button>
        </div>

        <!-- Action Area -->
        <div class="control-section">
          <!-- Button for Element Snip -->
          <button class="btn-action" id="fs-toggle-snip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Select Element</span>
          </button>

          <!-- Button for Full Page Snip -->
          <button class="btn-action" id="fs-trigger-fullpage" style="display: none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            <span>Capture Full Page</span>
          </button>
          
          <div class="mode-desc" id="fs-mode-desc">
            Hover over any web element to inspect, then click to capture its code.
          </div>
        </div>

        <!-- Empty State -->
        <div class="empty-state" id="fs-empty-state">
          <div class="empty-icon-wrapper">
            <svg class="empty-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
              <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
              <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
            </svg>
          </div>
          <div class="empty-title">Ready to Snip</div>
          <div class="empty-text">Select a capture mode above, then snip the clean frontend elements and styled assets.</div>
        </div>

        <!-- Preview Section -->
        <div class="preview-section" id="fs-preview-section" style="display: none;">
          <div class="preview-meta-card">
            <div class="meta-tag-info">
              <span class="meta-tag-badge" id="fs-meta-tag">div</span>
            </div>
            <div class="meta-details" id="fs-meta-info">0 children</div>
          </div>
          
          <div class="preview-header">
            <div class="tabs">
              <button class="tab active" id="fs-tab-html">HTML</button>
              <button class="tab" id="fs-tab-css">CSS</button>
            </div>
          </div>

          <div class="code-container">
            <button class="btn-copy" id="fs-btn-copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
            <textarea class="code-area" id="fs-code-area" readonly></textarea>
          </div>
        </div>
      </div>

      <div class="panel-footer">
        <button class="btn-download" id="fs-download-zip" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download ZIP Archive</span>
        </button>
      </div>
    </div>
  `;

  // Initialize and inject the sidebar
  const init = () => {
    if (sidebarRoot && shadowRoot && document.getElementById('frontend-snipper-sidebar-root')) return;

    if (!document.body) {
      console.warn("Frontend Snipper: document.body not available.");
      return;
    }

    // Create wrapper div in host page
    sidebarRoot = document.createElement('div');
    sidebarRoot.id = 'frontend-snipper-sidebar-root';
    document.body.appendChild(sidebarRoot);

    // Create shadow DOM to isolate styles
    shadowRoot = sidebarRoot.attachShadow({ mode: 'open' });

    // Inject fonts
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Fira+Code&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;600;700&display=swap';
    shadowRoot.appendChild(fontLink);

    // Inject Styles
    const styleEl = document.createElement('style');
    styleEl.textContent = shadowStyles;
    shadowRoot.appendChild(styleEl);

    // Inject Layout
    const uiContainer = document.createElement('div');
    uiContainer.style.width = '100%';
    uiContainer.style.height = '100%';
    uiContainer.innerHTML = panelHtml;
    shadowRoot.appendChild(uiContainer);

    // Load PNG extension icon from package assets
    shadowRoot.getElementById('fs-logo-img').src = chrome.runtime.getURL('icon_128.png');

    // Bind event listeners
    shadowRoot.getElementById('fs-close').addEventListener('click', () => {
      toggleSidebar(false);
    });

    shadowRoot.getElementById('fs-mode-element').addEventListener('click', () => {
      switchMode('element');
    });

    shadowRoot.getElementById('fs-mode-fullpage').addEventListener('click', () => {
      switchMode('fullpage');
    });

    shadowRoot.getElementById('fs-toggle-snip').addEventListener('click', () => {
      toggleInspectMode();
    });

    shadowRoot.getElementById('fs-trigger-fullpage').addEventListener('click', () => {
      triggerFullPageSnip();
    });

    shadowRoot.getElementById('fs-tab-html').addEventListener('click', () => {
      switchTab('html');
    });

    shadowRoot.getElementById('fs-tab-css').addEventListener('click', () => {
      switchTab('css');
    });

    shadowRoot.getElementById('fs-btn-copy').addEventListener('click', () => {
      copyToClipboard();
    });

    shadowRoot.getElementById('fs-download-zip').addEventListener('click', () => {
      triggerZipDownload();
    });
  };

  // Toggle Sidebar visibility
  const toggleSidebar = (forceState) => {
    init(); // Ensure created
    const isVisible = sidebarRoot.classList.contains('visible');
    const newState = forceState !== undefined ? forceState : !isVisible;

    if (newState) {
      sidebarRoot.classList.add('visible');
    } else {
      sidebarRoot.classList.remove('visible');
      if (isInspectActive) {
        toggleInspectMode(false); // Stop inspecting if panel is closed
      }
    }
  };

  // Switch between inspect modes
  const switchMode = (mode) => {
    if (activeMode === mode) return;
    activeMode = mode;

    const elementTab = shadowRoot.getElementById('fs-mode-element');
    const fullpageTab = shadowRoot.getElementById('fs-mode-fullpage');
    const elementBtn = shadowRoot.getElementById('fs-toggle-snip');
    const fullpageBtn = shadowRoot.getElementById('fs-trigger-fullpage');
    const modeDesc = shadowRoot.getElementById('fs-mode-desc');

    if (mode === 'element') {
      elementTab.classList.add('active');
      fullpageTab.classList.remove('active');
      elementBtn.style.display = 'flex';
      fullpageBtn.style.display = 'none';
      modeDesc.textContent = 'Hover over any web element to inspect, then click to capture its code.';
    } else {
      elementTab.classList.remove('active');
      fullpageTab.classList.add('active');
      elementBtn.style.display = 'none';
      fullpageBtn.style.display = 'flex';
      modeDesc.textContent = 'Capture the entire document and style tree into a portable package.';
      if (isInspectActive) {
        toggleInspectMode(false); // Turn off inspector if switching modes
      }
    }
  };

  // Toggle Inspecting Mode (Element Selection)
  const toggleInspectMode = (forceState) => {
    if (!shadowRoot) return;
    isInspectActive = forceState !== undefined ? forceState : !isInspectActive;
    const btn = shadowRoot.getElementById('fs-toggle-snip');
    if (!btn) return;
    const btnText = btn.querySelector('span');

    if (isInspectActive) {
      btn.classList.add('active');
      if (btnText) btnText.textContent = 'Cancel Snipping';
      // Dispatch custom event to notify snipper.js
      window.dispatchEvent(new CustomEvent('frontend-snipper-start'));
    } else {
      btn.classList.remove('active');
      if (btnText) btnText.textContent = 'Select Element';
      // Dispatch custom event to notify snipper.js
      window.dispatchEvent(new CustomEvent('frontend-snipper-stop'));
    }
  };

  // Trigger Full Page Snipping
  const triggerFullPageSnip = () => {
    // Dispatch custom event to notify snipper.js
    window.dispatchEvent(new CustomEvent('frontend-snipper-fullpage'));
  };

  // Switch between HTML and CSS tabs
  const switchTab = (tab) => {
    activeTab = tab;
    const tabHtml = shadowRoot.getElementById('fs-tab-html');
    const tabCss = shadowRoot.getElementById('fs-tab-css');
    const codeArea = shadowRoot.getElementById('fs-code-area');

    if (tab === 'html') {
      tabHtml.classList.add('active');
      tabCss.classList.remove('active');
      codeArea.value = snippedHtml;
    } else {
      tabHtml.classList.remove('active');
      tabCss.classList.add('active');
      codeArea.value = snippedCss;
    }
  };

  // Copy code area content to clipboard
  const copyToClipboard = () => {
    const codeArea = shadowRoot.getElementById('fs-code-area');
    const copyBtn = shadowRoot.getElementById('fs-btn-copy');
    const copySpan = copyBtn.querySelector('span');

    codeArea.select();
    navigator.clipboard.writeText(codeArea.value).then(() => {
      copySpan.textContent = 'Copied!';
      copyBtn.classList.add('success');
      setTimeout(() => {
        copySpan.textContent = 'Copy';
        copyBtn.classList.remove('success');
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // Call zip packaging function and trigger download message
  const triggerZipDownload = () => {
    if (!snippedHtml || !snippedCss) return;
    
    // Dispatch custom event to notify snipper.js to package and download
    window.dispatchEvent(new CustomEvent('frontend-snipper-download', {
      detail: {
        html: snippedHtml,
        css: snippedCss,
        tagName: currentTagName
      }
    }));
  };

  // Show processing loader
  const showLoading = (text = 'Analyzing DOM Tree', subtext = 'Extracting computed styles and layout...') => {
    init();
    const overlay = shadowRoot.getElementById('fs-loading-overlay');
    overlay.querySelector('.loading-text').textContent = text;
    overlay.querySelector('.loading-subtext').textContent = subtext;
    overlay.classList.add('visible');
  };

  // Hide processing loader
  const hideLoading = () => {
    if (!shadowRoot) return;
    const overlay = shadowRoot.getElementById('fs-loading-overlay');
    if (overlay) overlay.classList.remove('visible');
  };

  // Expose UI functions to global window context
  window.FrontendSnipperUI = {
    toggle: toggleSidebar,
    stopInspect: () => {
      toggleInspectMode(false);
    },
    showLoading: showLoading,
    hideLoading: hideLoading,
    updatePreview: (html, css, tagName, childCount) => {
      snippedHtml = html;
      snippedCss = css;
      currentTagName = tagName.toLowerCase();

      // Ensure loader is hidden
      hideLoading();

      // Update UI elements
      shadowRoot.getElementById('fs-empty-state').style.display = 'none';
      shadowRoot.getElementById('fs-preview-section').style.display = 'flex';
      
      const tagBadge = shadowRoot.getElementById('fs-meta-tag');
      tagBadge.textContent = currentTagName;

      const metaInfo = shadowRoot.getElementById('fs-meta-info');
      metaInfo.textContent = `${childCount} child element${childCount === 1 ? '' : 's'}`;
      
      // Enable download button
      shadowRoot.getElementById('fs-download-zip').removeAttribute('disabled');

      // Default back to HTML tab view
      switchTab('html');
    }
  };

  // Listen to toggle messages from background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggleSidePanel') {
      toggleSidebar();
    }
  });

})();
