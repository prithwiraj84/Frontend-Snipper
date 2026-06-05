// Frontend Snipper Core Logic (Content Script)

(function () {
  // Overwrite Core properties to bind to current script context on injection/reload

  let isInspectActive = false;
  let hoveredElement = null;

  // List of CSS properties to extract
  const PROPERTIES_TO_EXTRACT = [
    // Layout & Display
    "display", "position", "top", "right", "bottom", "left", "float", "clear", 
    "z-index", "visibility", "opacity", "overflow", "overflow-x", "overflow-y", 
    "box-sizing", "clip-path", "aspect-ratio", "filter", "backdrop-filter", "-webkit-backdrop-filter",
    // Flexbox
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", 
    "flex-grow", "flex-shrink", "flex-basis", "align-self", "order",
    // Grid
    "grid-template-columns", "grid-template-rows", "grid-template-areas", 
    "grid-auto-columns", "grid-auto-rows", "grid-auto-flow", 
    "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", 
    "gap", "row-gap", "column-gap", "justify-items", "justify-self", "place-items", "place-content", "place-self",
    // Sizing
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    // Spacing
    "margin-top", "margin-right", "margin-bottom", "margin-left", 
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    // Typography
    "font-family", "font-size", "font-weight", "font-style", "line-height", 
    "letter-spacing", "text-align", "text-decoration", "text-transform", 
    "white-space", "word-break", "word-wrap", "overflow-wrap", "text-overflow", "vertical-align", "color",
    // Backgrounds
    "background-color", "background-image", "background-repeat", 
    "background-position", "background-size", "background-clip", "background-origin",
    // Borders & Corners
    "border-top-width", "border-top-style", "border-top-color",
    "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", 
    "border-bottom-left-radius", "border-bottom-right-radius",
    "outline-width", "outline-style", "outline-color", "box-shadow",
    "border-collapse", "border-spacing",
    // Lists
    "list-style", "list-style-type", "list-style-position",
    // SVG specific styles
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", 
    "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", 
    "vector-effect",
    // Effects / Transforms
    "transform", "transform-origin", "transition-property", "transition-duration", 
    "transition-timing-function", "transition-delay", "cursor"
  ];

  const INHERITED_PROPERTIES = new Set([
    "visibility",
    // Typography
    "font-family", "font-size", "font-weight", "font-style", "line-height", 
    "letter-spacing", "text-align", "text-transform", "white-space", 
    "word-break", "word-wrap", "overflow-wrap", "color",
    // Table / List
    "border-collapse", "border-spacing",
    "list-style", "list-style-type", "list-style-position",
    // SVG
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", 
    "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
    // Misc
    "cursor"
  ]);

  // Cache for browser default style definitions to avoid redundant DOM writes
  const defaultStylesCache = {};
  let defaultStylesIframe = null;

  // Create iframe context for clean browser default style evaluation
  function initDefaultStylesIframe() {
    if (defaultStylesIframe) return;
    try {
      defaultStylesIframe = document.createElement('iframe');
      defaultStylesIframe.style.display = 'none';
      document.documentElement.appendChild(defaultStylesIframe);
      
      // Force synchronous document initialization inside iframe
      const doc = defaultStylesIframe.contentDocument || defaultStylesIframe.contentWindow.document;
      if (doc) {
        doc.open();
        doc.write("<!DOCTYPE html><html><body></body></html>");
        doc.close();
      }
    } catch (e) {
      console.warn("Failed to create default styles iframe (possibly CSP):", e);
      defaultStylesIframe = null;
    }
  }

  // Destroy evaluation context iframe
  function destroyDefaultStylesIframe() {
    if (defaultStylesIframe) {
      try {
        defaultStylesIframe.remove();
      } catch (e) {}
      defaultStylesIframe = null;
    }
  }

  // Retrieve browser default computed styles for a given tag
  function getDefaultStyles(tagName, isSvg = false) {
    const cacheKey = (isSvg ? "svg:" : "") + tagName.toLowerCase();
    if (defaultStylesCache[cacheKey]) {
      return defaultStylesCache[cacheKey];
    }

    initDefaultStylesIframe();

    let useFallback = false;
    let doc = document;
    let win = window;

    if (defaultStylesIframe) {
      try {
        const iframeDoc = defaultStylesIframe.contentDocument || defaultStylesIframe.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          doc = iframeDoc;
          win = defaultStylesIframe.contentWindow;
        } else {
          useFallback = true;
        }
      } catch (e) {
        useFallback = true;
      }
    } else {
      useFallback = true;
    }

    // Special handling for root tags to avoid invalid DOM nesting
    const lowerTag = tagName.toLowerCase();
    if (lowerTag === 'html' && !useFallback) {
      try {
        const computed = win.getComputedStyle(doc.documentElement);
        const defaults = {};
        PROPERTIES_TO_EXTRACT.forEach(prop => {
          defaults[prop] = computed.getPropertyValue(prop);
        });
        defaultStylesCache[cacheKey] = defaults;
        return defaults;
      } catch (err) {
        useFallback = true;
      }
    }

    if (lowerTag === 'body' && !useFallback) {
      try {
        const computed = win.getComputedStyle(doc.body);
        const defaults = {};
        PROPERTIES_TO_EXTRACT.forEach(prop => {
          defaults[prop] = computed.getPropertyValue(prop);
        });
        defaultStylesCache[cacheKey] = defaults;
        return defaults;
      } catch (err) {
        useFallback = true;
      }
    }

    let dummy;
    let container = null;
    
    try {
      if (isSvg) {
        container = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        dummy = doc.createElementNS("http://www.w3.org/2000/svg", tagName);
        container.appendChild(dummy);
        if (useFallback) {
          doc.documentElement.appendChild(container);
        } else {
          doc.body.appendChild(container);
        }
      } else {
        dummy = doc.createElement(tagName);
        if (useFallback) {
          doc.documentElement.appendChild(dummy);
        } else {
          doc.body.appendChild(dummy);
        }
      }

      const computed = win.getComputedStyle(dummy);
      const defaults = {};
      PROPERTIES_TO_EXTRACT.forEach(prop => {
        defaults[prop] = computed.getPropertyValue(prop);
      });

      if (container) {
        if (useFallback) {
          doc.documentElement.removeChild(container);
        } else {
          doc.body.removeChild(container);
        }
      } else {
        if (useFallback) {
          doc.documentElement.removeChild(dummy);
        } else {
          doc.body.removeChild(dummy);
        }
      }

      defaultStylesCache[cacheKey] = defaults;
      return defaults;
    } catch (err) {
      console.error("Error generating default styles for tag", tagName, err);
      const empty = {};
      PROPERTIES_TO_EXTRACT.forEach(prop => {
        empty[prop] = "";
      });
      return empty;
    }
  }

  // Extracts style details for document root (html)
  function extractRootStyles() {
    const element = document.documentElement;
    const computed = window.getComputedStyle(element);
    const defaults = getDefaultStyles('html', false);
    const rules = [];

    PROPERTIES_TO_EXTRACT.forEach(prop => {
      let val = computed.getPropertyValue(prop);
      let defVal = defaults[prop];

      if (prop === 'background-image') {
        val = resolveCssUrl(val);
      }

      if (val !== defVal) {
        rules.push(`  ${prop}: ${val};`);
      }
    });

    if (rules.length === 0) return '';
    return `html {\n${rules.join('\n')}\n}`;
  }

  // Resolve relative URLs in CSS url() declarations
  function resolveCssUrl(cssValue) {
    if (!cssValue || !cssValue.includes('url(')) return cssValue;
    return cssValue.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, url) => {
      if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return match;
      }
      try {
        const absoluteUrl = new URL(url, window.location.href).href;
        return `url(${quote}${absoluteUrl}${quote})`;
      } catch (e) {
        return match;
      }
    });
  }

  // Resolve relative asset URLs in HTML elements
  function resolveHtmlUrls(clone) {
    const resolve = (url) => {
      if (!url || url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      try {
        return new URL(url, window.location.href).href;
      } catch (e) {
        return url;
      }
    };

    // Images
    clone.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src) img.setAttribute('src', resolve(src));

      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const resolved = srcset.split(',').map(part => {
          const trimmed = part.trim();
          const spaceIdx = trimmed.indexOf(' ');
          if (spaceIdx === -1) return resolve(trimmed);
          const url = trimmed.substring(0, spaceIdx);
          const descriptor = trimmed.substring(spaceIdx);
          return `${resolve(url)}${descriptor}`;
        }).join(', ');
        img.setAttribute('srcset', resolved);
      }
    });

    // Picture Sources
    clone.querySelectorAll('source').forEach(source => {
      const src = source.getAttribute('src');
      if (src) source.setAttribute('src', resolve(src));

      const srcset = source.getAttribute('srcset');
      if (srcset) {
        const resolved = srcset.split(',').map(part => {
          const trimmed = part.trim();
          const spaceIdx = trimmed.indexOf(' ');
          if (spaceIdx === -1) return resolve(trimmed);
          const url = trimmed.substring(0, spaceIdx);
          const descriptor = trimmed.substring(spaceIdx);
          return `${resolve(url)}${descriptor}`;
        }).join(', ');
        source.setAttribute('srcset', resolved);
      }
    });

    // Anchors
    clone.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        a.setAttribute('href', resolve(href));
      }
    });

    // Inline style attributes
    clone.querySelectorAll('*').forEach(el => {
      const style = el.getAttribute('style');
      if (style) el.setAttribute('style', resolveCssUrl(style));
    });
    if (clone.getAttribute('style')) {
      clone.setAttribute('style', resolveCssUrl(clone.getAttribute('style')));
    }
  }

  // Sanitizes cloned element tree
  function sanitizeHtml(clone) {
    // Remove the sidebar root if it exists inside the clone
    const sidebar = clone.querySelector('#frontend-snipper-sidebar-root');
    if (sidebar) sidebar.remove();
    if (clone.id === 'frontend-snipper-sidebar-root') {
      clone.remove();
      return;
    }

    // 1. Remove all scripts
    clone.querySelectorAll('script').forEach(el => el.remove());
    if (clone.tagName.toLowerCase() === 'script') {
      clone.remove();
      return;
    }

    // 2. Strip event handlers (onclick, onload, etc.)
    const stripEvents = (el) => {
      const toRemove = [];
      for (let i = 0; i < el.attributes.length; i++) {
        const attrName = el.attributes[i].name;
        if (attrName.startsWith('on')) {
          toRemove.push(attrName);
        }
      }
      toRemove.forEach(attr => el.removeAttribute(attr));
    };

    stripEvents(clone);
    clone.querySelectorAll('*').forEach(stripEvents);
  }

  // Find inherited background-color from parent tree
  function getInheritedBackgroundColor(element) {
    let el = element;
    while (el && el !== document.documentElement) {
      const bg = window.getComputedStyle(el).getPropertyValue('background-color');
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgba(0,0,0,0)') {
        return bg;
      }
      el = el.parentElement;
    }
    return '#ffffff';
  }

  // Extracts inline and stylesheet styles for a single element
  function extractElementStyles(element, snipId, parentElement = null) {
    const isSvg = element.namespaceURI === 'http://www.w3.org/2000/svg';
    const computed = window.getComputedStyle(element);
    const parentComputed = parentElement ? window.getComputedStyle(parentElement) : null;
    const defaults = getDefaultStyles(element.tagName, isSvg);
    const rules = [];

    const tagName = element.tagName.toLowerCase();
    const isAsset = ['img', 'svg', 'canvas', 'video', 'iframe', 'embed', 'object', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline'].includes(tagName);

    PROPERTIES_TO_EXTRACT.forEach(prop => {
      let val = computed.getPropertyValue(prop);
      let defVal = defaults[prop];

      // Dynamic dimension analyzer for width
      if (prop === 'width' && !isAsset) {
        try {
          const originalInline = element.style.width;
          element.style.width = 'auto';
          const autoVal = computed.getPropertyValue('width');
          element.style.width = originalInline;
          if (val === autoVal) {
            return;
          }
        } catch (e) {}
      }

      // Dynamic dimension analyzer for height
      if (prop === 'height' && !isAsset) {
        try {
          const originalInline = element.style.height;
          element.style.height = 'auto';
          const autoVal = computed.getPropertyValue('height');
          element.style.height = originalInline;
          if (val === autoVal) {
            return;
          }
        } catch (e) {}
      }

      // Resolve background URLs
      if (prop === 'background-image') {
        val = resolveCssUrl(val);
      }

      // Determine inheritance vs browser default override
      let shouldInclude = false;
      if (INHERITED_PROPERTIES.has(prop)) {
        if (parentComputed) {
          const parentVal = parentComputed.getPropertyValue(prop);
          shouldInclude = (val !== parentVal);
        } else {
          shouldInclude = (val !== defVal);
        }
      } else {
        shouldInclude = (val !== defVal);
      }

      if (shouldInclude) {
        rules.push(`  ${prop}: ${val};`);
      }
    });

    if (rules.length === 0) return '';
    return `[data-snip-id="${snipId}"] {\n${rules.join('\n')}\n}`;
  }

  // Extracts style details for pseudo-elements (::before, ::after)
  function extractPseudoStyles(element, snipId, pseudoName) {
    const computed = window.getComputedStyle(element, pseudoName);
    const content = computed.getPropertyValue('content');

    // Pseudo-element is not active or empty
    if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
      return '';
    }

    const hostComputed = window.getComputedStyle(element);
    const rules = [`  content: ${content};`];
    // Compare pseudo properties against default span styles (as inline defaults)
    const defaults = getDefaultStyles('span', false);

    PROPERTIES_TO_EXTRACT.forEach(prop => {
      if (prop === 'content') return; // Handled separately
      let val = computed.getPropertyValue(prop);
      let defVal = defaults[prop];

      if (prop === 'background-image') {
        val = resolveCssUrl(val);
      }

      let shouldInclude = false;
      if (INHERITED_PROPERTIES.has(prop)) {
        const hostVal = hostComputed.getPropertyValue(prop);
        shouldInclude = (val !== hostVal);
      } else {
        shouldInclude = (val !== defVal);
      }

      if (shouldInclude) {
        rules.push(`  ${prop}: ${val};`);
      }
    });

    return `[data-snip-id="${snipId}"]${pseudoName} {\n${rules.join('\n')}\n}`;
  }

  // Main implementation of extraction on target element
  function performSnip(target) {
    const isFullPage = target === document.body;
    if (window.FrontendSnipperUI) {
      window.FrontendSnipperUI.showLoading(
        isFullPage ? 'Compiling Page DOM' : 'Analyzing Element DOM',
        'Extracting computed styles and structures...'
      );
    }

    // Set timeout to let UI redraw overlay before thread blocking computation starts
    setTimeout(() => {
      try {
        initDefaultStylesIframe();
        const inheritedBg = getInheritedBackgroundColor(target);
        target.setAttribute('data-fs-inherited-bg', inheritedBg);

        const cssRules = [];
        let snipIdCounter = 0;
        const taggedNodes = [];

        // Prepend root HTML styles if capturing full page
        if (isFullPage) {
          const rootCss = extractRootStyles();
          if (rootCss) cssRules.push(rootCss);
        }

        const visitedNodes = new Set();
        // Parallel recursive DOM walker to tag live DOM temporarily
        function walkAndTag(node, parentNode = null) {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (visitedNodes.has(node)) return;
          visitedNodes.add(node);

          // Skip our injected UI panel entirely
          if (node.id === 'frontend-snipper-sidebar-root') return;

          const snipId = `snip-${snipIdCounter++}`;
          node.setAttribute('data-snip-id', snipId);
          taggedNodes.push(node);

          // Extract styles - root element in Element mode gets no parent relative comparison
          const isTarget = (node === target);
          const parentContext = (isTarget && !isFullPage) ? null : parentNode;

          const selfCss = extractElementStyles(node, snipId, parentContext);
          if (selfCss) cssRules.push(selfCss);

          // Extract pseudos
          const beforeCss = extractPseudoStyles(node, snipId, '::before');
          if (beforeCss) cssRules.push(beforeCss);

          const afterCss = extractPseudoStyles(node, snipId, '::after');
          if (afterCss) cssRules.push(afterCss);

          // Recurse children via static array snapshot to prevent live collection mutations from causing loops
          const children = Array.from(node.children);
          for (let i = 0; i < children.length; i++) {
            walkAndTag(children[i], node);
          }
        }

        // Tag and extract
        walkAndTag(target, target.parentElement);

        // Deep clone
        const clone = target.cloneNode(true);

        // Remove tags from live DOM immediately
        taggedNodes.forEach(node => node.removeAttribute('data-snip-id'));
        target.removeAttribute('data-fs-inherited-bg');
        destroyDefaultStylesIframe();

        // Sanitize and resolve asset URLs on cloned node
        sanitizeHtml(clone);
        resolveHtmlUrls(clone);

        // Code formatting
        const formattedHtml = clone.outerHTML;
        const formattedCss = cssRules.join('\n\n');

        const childCount = clone.querySelectorAll('*').length;

        // Display preview in Sidebar
        if (window.FrontendSnipperUI) {
          window.FrontendSnipperUI.updatePreview(formattedHtml, formattedCss, target.tagName, childCount);
        }
      } catch (err) {
        console.error("DOM Snipping failed:", err);
        destroyDefaultStylesIframe();
        if (window.FrontendSnipperUI) {
          window.FrontendSnipperUI.hideLoading();
        }
        alert("Snipping process failed: " + err.message);
      }
    }, 50);
  }

  // Snip selection logic (Element click callback)
  function selectElement(event) {
    if (!isInspectActive) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.target;
    
    // Ignore UI panel elements
    if (target.closest('#frontend-snipper-sidebar-root')) {
      return;
    }

    // Stop inspect mode
    stopInspecting();

    // Perform actual extraction
    performSnip(target);
  }

  // Mousemove listener to update highlight outlines
  function handleMouseMove(event) {
    if (!isInspectActive) return;

    const target = event.target;
    
    // Ignore UI panel elements
    if (target.closest('#frontend-snipper-sidebar-root')) {
      if (hoveredElement) {
        hoveredElement.classList.remove('frontend-snipper-hovered');
        hoveredElement = null;
      }
      return;
    }

    if (hoveredElement !== target) {
      if (hoveredElement) {
        hoveredElement.classList.remove('frontend-snipper-hovered');
      }
      hoveredElement = target;
      hoveredElement.classList.add('frontend-snipper-hovered');
    }
  }

  // Start Inspect mode listeners
  function startInspecting() {
    isInspectActive = true;
    document.body.classList.add('frontend-snipper-inspecting');
    
    document.addEventListener('mouseover', handleMouseMove);
    document.addEventListener('click', selectElement, true);
  }

  // Stop Inspect mode listeners
  function stopInspecting() {
    isInspectActive = false;
    document.body.classList.remove('frontend-snipper-inspecting');
    
    if (hoveredElement) {
      hoveredElement.classList.remove('frontend-snipper-hovered');
      hoveredElement = null;
    }

    document.removeEventListener('mouseover', handleMouseMove);
    document.removeEventListener('click', selectElement, true);

    // Reset UI button state
    if (window.FrontendSnipperUI) {
      window.FrontendSnipperUI.stopInspect();
    }
  }

  // Triggered when requesting full page snip
  function handleFullPageSnip() {
    performSnip(document.body);
  }

  // ZIP packaging and download trigger
  function handleDownload(event) {
    const { html, css, tagName } = event.detail;

    // Find all stylesheet font link tags in the host page
    const fontLinks = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href && (href.includes('fonts.googleapis.com') || href.includes('fonts.gstatic.com') || href.includes('font') || href.includes('typekit') || href.includes('awesome'))) {
        try {
          const absoluteUrl = new URL(href, window.location.href).href;
          fontLinks.push(`<link rel="stylesheet" href="${absoluteUrl}">`);
        } catch (e) {}
      }
    });

    // Also copy custom inline style font imports
    document.querySelectorAll('style').forEach(style => {
      const content = style.textContent;
      if (content.includes('@import') && (content.includes('font') || content.includes('awesome') || content.includes('typekit'))) {
        const imports = content.match(/@import\s+url\((['"]?)(.*?)\1\);/g);
        if (imports) {
          imports.forEach(imp => fontLinks.push(`<style>${imp}</style>`));
        }
      }
    });

    // Retrieve background color calculated during selection
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const innerNode = tempDiv.firstElementChild;
    const bg = innerNode ? (innerNode.getAttribute('data-fs-inherited-bg') || '#ffffff') : '#ffffff';
    if (innerNode) {
      innerNode.removeAttribute('data-fs-inherited-bg'); // Strip temp attribute
    }
    const cleanHtml = tempDiv.innerHTML;

    // Wrap in standard HTML5 boilerplate
    let indexHtmlContent = '';
    
    if (tagName.toLowerCase() === 'body') {
      // Full page snip
      indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frontend Snippet - ${tagName.toUpperCase()}</title>
  ${fontLinks.join('\n  ')}
  <link rel="stylesheet" href="styles.css">
</head>
${cleanHtml}
</html>`;
    } else {
      // Element snip
      indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frontend Snippet - ${tagName.toUpperCase()}</title>
  ${fontLinks.join('\n  ')}
  <link rel="stylesheet" href="styles.css">
  <style>
    /* Simple preview reset and container background matching host page */
    body {
      margin: 0;
      padding: 40px;
      box-sizing: border-box;
      background-color: ${bg};
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  ${cleanHtml}
</body>
</html>`;
    }

    // Instantiate JSZip
    if (typeof JSZip === 'undefined') {
      console.error('JSZip library is not loaded!');
      alert('JSZip library error: Could not compile files.');
      return;
    }

    const zip = new JSZip();
    zip.file('index.html', indexHtmlContent);
    zip.file('styles.css', css);

    // Generate ZIP as base64 string
    zip.generateAsync({ type: 'base64' }).then((base64String) => {
      // Send download trigger to background script
      chrome.runtime.sendMessage({
        action: 'downloadZip',
        filename: `snipper_${tagName.toLowerCase()}.zip`,
        base64Data: base64String
      });
    }).catch(err => {
      console.error('ZIP compilation error:', err);
    });
  }

  // Remove old listeners from previous execution to prevent duplicates on reload
  if (window.FrontendSnipperListeners) {
    window.removeEventListener('frontend-snipper-start', window.FrontendSnipperListeners.start);
    window.removeEventListener('frontend-snipper-stop', window.FrontendSnipperListeners.stop);
    window.removeEventListener('frontend-snipper-fullpage', window.FrontendSnipperListeners.fullpage);
    window.removeEventListener('frontend-snipper-download', window.FrontendSnipperListeners.download);
  }

  // Store new listener references on window
  window.FrontendSnipperListeners = {
    start: startInspecting,
    stop: stopInspecting,
    fullpage: handleFullPageSnip,
    download: handleDownload
  };

  // Event coordination listeners (between ui.js and snipper.js)
  window.addEventListener('frontend-snipper-start', startInspecting);
  window.addEventListener('frontend-snipper-stop', stopInspecting);
  window.addEventListener('frontend-snipper-fullpage', handleFullPageSnip);
  window.addEventListener('frontend-snipper-download', handleDownload);

  // Expose Core Controller
  window.FrontendSnipperCore = {
    start: startInspecting,
    stop: stopInspecting,
    isInspecting: () => isInspectActive,
    snipFullPage: handleFullPageSnip
  };
})();
