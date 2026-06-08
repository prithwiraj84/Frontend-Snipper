// Frontend Snipper Core Logic (Content Script)
//
// Goal: export HTML + CSS that renders identically ("same to same") to the captured page/element.
//
// Strategy — FAITHFUL stylesheet inlining (not computed-style reconstruction):
//   * The page's OWN authored stylesheets are inlined verbatim (every rule, @media, @supports,
//     @keyframes, @font-face, :root variables, :hover/:focus states, grid-template-areas — all
//     of it), with url() made absolute. This reproduces the real cascade exactly, including
//     responsive breakpoints and named-grid layouts that a per-property computed snapshot loses.
//   * The real HTML is kept with its original classes/ids/inline-styles, so every selector still
//     matches. For an element snip, the element's ancestor chain is reconstructed (shallow clones
//     carrying their classes) so contextual selectors like `.dark .card` and `>` combinators apply.
//   * Cross-origin stylesheets (whose rules JS can't read) are fetched through the background
//     worker at download time, with @import chains followed and url() resolved against the
//     post-redirect base.
//   * <canvas> bitmaps are rasterised to <img>, and referenced images/fonts are embedded into the
//     ZIP, delivered as a Blob so even large captures download reliably and work fully offline.

(function () {
  let isInspectActive = false;
  let hoveredElement = null;

  // -------- URL resolution --------

  function resolveUrl(url, base) {
    if (!url) return url;
    const trimmed = url.trim();
    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:") ||
        trimmed.startsWith("http://") || trimmed.startsWith("https://") ||
        trimmed.startsWith("#") || trimmed.startsWith("about:")) {
      return trimmed;
    }
    try {
      return new URL(trimmed, base || window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function resolveCssUrl(cssText, base) {
    if (!cssText || cssText.indexOf("url(") === -1) return cssText;
    return cssText.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g, (match, quote, url) => {
      return "url(" + quote + resolveUrl(url, base) + quote + ")";
    });
  }

  // -------- Authored CSS collection --------
  //
  // Serialize a CSSRuleList to text, resolving url() against the sheet base and inlining
  // accessible @imports. Cross-origin sheets/imports leave a placeholder marker that is replaced
  // with fetched CSS at download time, preserving original cascade order.

  function serializeRules(rules, baseHref, markers) {
    let out = "";
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        if (rule.type === CSSRule.IMPORT_RULE) {
          let sub = null;
          try { sub = rule.styleSheet ? rule.styleSheet.cssRules : null; } catch (e) { sub = null; }
          if (sub) {
            out += serializeRules(sub, (rule.styleSheet && rule.styleSheet.href) || baseHref, markers) + "\n";
          } else if (rule.href) {
            const href = resolveUrl(rule.href, baseHref);
            const marker = "/*__FS_FETCH_" + markers.length + "__*/";
            markers.push({ marker: marker, href: href });
            out += marker + "\n";
          }
        } else {
          out += resolveCssUrl(rule.cssText, baseHref) + "\n";
        }
      } catch (e) { /* skip a single problematic rule */ }
    }
    return out;
  }

  function collectAuthoredCss(markers) {
    const parts = [];
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      // Skip our own injected content-script CSS (theme.css).
      if (sheet.href && sheet.href.startsWith("chrome-extension://")) continue;
      // Skip stylesheets owned by our sidebar, just in case.
      if (sheet.ownerNode && sheet.ownerNode.closest && sheet.ownerNode.closest("#frontend-snipper-sidebar-root")) continue;

      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { rules = null; }
      if (rules) {
        parts.push(serializeRules(rules, sheet.href || window.location.href, markers));
      } else if (sheet.href) {
        const marker = "/*__FS_FETCH_" + markers.length + "__*/";
        markers.push({ marker: marker, href: sheet.href });
        parts.push(marker);
      }
    }
    // Constructable / adopted stylesheets (CSS-in-JS, design systems).
    try {
      const adopted = document.adoptedStyleSheets || [];
      for (let i = 0; i < adopted.length; i++) {
        try { parts.push(serializeRules(adopted[i].cssRules, window.location.href, markers)); } catch (e) {}
      }
    } catch (e) {}

    return parts.join("\n");
  }

  // -------- HTML hygiene --------

  function resolveHtmlUrls(root) {
    const resolve = (url) => resolveUrl(url, window.location.href);
    const fixSrcset = (value) => value.split(",").map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) return resolve(trimmed);
      return resolve(trimmed.substring(0, spaceIdx)) + trimmed.substring(spaceIdx);
    }).filter(Boolean).join(", ");

    const all = root.querySelectorAll ? [root].concat(Array.from(root.querySelectorAll("*"))) : [root];
    all.forEach((el) => {
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (["img", "source", "video", "audio", "track", "embed", "input"].includes(tag)) {
        const src = el.getAttribute("src");
        if (src) el.setAttribute("src", resolve(src));
        const poster = el.getAttribute("poster");
        if (poster) el.setAttribute("poster", resolve(poster));
        const srcset = el.getAttribute("srcset");
        if (srcset) el.setAttribute("srcset", fixSrcset(srcset));
      }
      if (tag === "image") {
        const href = el.getAttribute("href");
        if (href) el.setAttribute("href", resolve(href));
        const xhref = el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || el.getAttribute("xlink:href");
        if (xhref) el.setAttributeNS("http://www.w3.org/1999/xlink", "href", resolve(xhref));
      }
      if (tag === "a") {
        const href = el.getAttribute("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) el.setAttribute("href", resolve(href));
      }
      const style = el.getAttribute && el.getAttribute("style");
      if (style && style.indexOf("url(") !== -1) el.setAttribute("style", resolveCssUrl(style, window.location.href));
    });
  }

  // Keep classes / ids / inline styles (they are part of the page's real appearance). Remove only
  // scripts, event handlers, our own sidebar, and embedded stylesheets/links (CSS is inlined separately).
  function sanitizeClone(root) {
    const sidebar = root.querySelector ? root.querySelector("#frontend-snipper-sidebar-root") : null;
    if (sidebar) sidebar.remove();
    if (root.id === "frontend-snipper-sidebar-root") { root.remove(); return; }

    const drop = root.querySelectorAll ? root.querySelectorAll("script, style, link, noscript, template") : [];
    drop.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "link") {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        if (rel.includes("stylesheet") || rel.includes("preload") || rel.includes("modulepreload") || rel.includes("prefetch") || rel.includes("dns-prefetch") || rel.includes("preconnect")) el.remove();
      } else {
        el.remove();
      }
    });

    const stripEvents = (el) => {
      if (!el.attributes) return;
      const toRemove = [];
      for (let i = 0; i < el.attributes.length; i++) {
        if (el.attributes[i].name.toLowerCase().startsWith("on")) toRemove.push(el.attributes[i].name);
      }
      toRemove.forEach((a) => el.removeAttribute(a));
    };
    if (root.tagName && root.tagName.toLowerCase() === "script") { root.remove(); return; }
    stripEvents(root);
    if (root.querySelectorAll) root.querySelectorAll("*").forEach(stripEvents);
  }

  function serializeAttributes(el) {
    let s = "";
    if (!el.attributes) return s;
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr.name.toLowerCase().startsWith("on")) continue;
      s += " " + attr.name + '="' + String(attr.value).replace(/"/g, "&quot;") + '"';
    }
    return s;
  }

  // -------- Canvas rasterisation --------

  function canvasList(root) {
    const list = [];
    if (root.tagName && root.tagName.toLowerCase() === "canvas") list.push(root);
    if (root.querySelectorAll) root.querySelectorAll("canvas").forEach((c) => list.push(c));
    return list;
  }

  function rasterizeCanvases(source) {
    const shots = [];
    canvasList(source).forEach((canvas) => {
      let dataUrl = null;
      try {
        if (canvas.width > 0 && canvas.height > 0) dataUrl = canvas.toDataURL("image/png");
      } catch (e) { dataUrl = null; } // tainted (cross-origin) canvas — leave blank
      shots.push(dataUrl);
    });
    return shots;
  }

  function applyCanvasShots(clone, shots) {
    if (!shots || !shots.length) return;
    const cloneCanvases = canvasList(clone);
    for (let i = 0; i < cloneCanvases.length && i < shots.length; i++) {
      const dataUrl = shots[i];
      if (!dataUrl) continue;
      const c = cloneCanvases[i];
      const img = (clone.ownerDocument || document).createElement("img");
      img.src = dataUrl;
      if (c.getAttribute("class")) img.setAttribute("class", c.getAttribute("class"));
      if (c.getAttribute("id")) img.setAttribute("id", c.getAttribute("id"));
      if (c.getAttribute("style")) img.setAttribute("style", c.getAttribute("style"));
      if (c.width) img.setAttribute("width", c.getAttribute("width") || c.width);
      if (c.height) img.setAttribute("height", c.getAttribute("height") || c.height);
      img.setAttribute("alt", "");
      if (c.parentNode) c.parentNode.replaceChild(img, c);
    }
  }

  // -------- HTML clone construction --------

  // Returns a <body> element clone. For element snips the target's ancestor chain is reconstructed
  // (shallow clones with their attributes) so contextual selectors and the page background apply.
  function buildBodyClone(target, isFullPage) {
    if (isFullPage) return document.body.cloneNode(true);

    let node = target.cloneNode(true);
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      if (ancestor.id !== "frontend-snipper-sidebar-root") {
        const wrapper = ancestor.cloneNode(false);
        wrapper.appendChild(node);
        node = wrapper;
      }
      if (ancestor === document.body) break;
      ancestor = ancestor.parentElement;
    }
    if (node.tagName && node.tagName.toLowerCase() === "body") return node;
    const bodyClone = document.body.cloneNode(false);
    bodyClone.appendChild(node);
    return bodyClone;
  }

  // -------- Main extraction --------

  let lastSnipContext = null;

  function performSnip(target) {
    const isFullPage = target === document.body || target === document.documentElement;
    if (target === document.documentElement) target = document.body;

    if (window.FrontendSnipperUI) {
      window.FrontendSnipperUI.showLoading(
        isFullPage ? "Compiling Page" : "Capturing Element",
        "Inlining the page's real stylesheets and assets..."
      );
    }

    setTimeout(() => {
      try {
        // 1. Collect the page's authored CSS verbatim (placeholders for cross-origin sheets).
        const markers = [];
        const authoredCss = collectAuthoredCss(markers);

        // 2. Build the HTML clone (keeps classes/ids/inline styles; rasterises canvases).
        const source = isFullPage ? document.body : target;
        const shots = rasterizeCanvases(source);
        const bodyClone = buildBodyClone(target, isFullPage);
        applyCanvasShots(bodyClone, shots);
        sanitizeClone(bodyClone);
        resolveHtmlUrls(bodyClone);

        const htmlAttrs = serializeAttributes(document.documentElement);
        const formattedHtml = bodyClone.outerHTML;
        const formattedCss = authoredCss.trim() ? authoredCss : "/* No author stylesheets were found on this page. */";
        const childCount = bodyClone.querySelectorAll("*").length;

        lastSnipContext = {
          markers: markers,
          htmlAttrs: htmlAttrs,
          isFullPage: isFullPage
        };

        if (window.FrontendSnipperUI) {
          window.FrontendSnipperUI.updatePreview(formattedHtml, formattedCss, target.tagName, childCount);
        }
      } catch (err) {
        console.error("Frontend Snipper: extraction failed:", err);
        if (window.FrontendSnipperUI) window.FrontendSnipperUI.hideLoading();
        alert("Snipping process failed: " + err.message);
      }
    }, 50);
  }

  // -------- Inspect mode --------

  function selectElement(event) {
    if (!isInspectActive) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    if (target.closest("#frontend-snipper-sidebar-root")) return;
    stopInspecting();
    performSnip(target);
  }

  function handleMouseMove(event) {
    if (!isInspectActive) return;
    const target = event.target;
    if (target.closest("#frontend-snipper-sidebar-root")) {
      if (hoveredElement) { hoveredElement.classList.remove("frontend-snipper-hovered"); hoveredElement = null; }
      return;
    }
    if (hoveredElement !== target) {
      if (hoveredElement) hoveredElement.classList.remove("frontend-snipper-hovered");
      hoveredElement = target;
      hoveredElement.classList.add("frontend-snipper-hovered");
    }
  }

  function startInspecting() {
    isInspectActive = true;
    document.body.classList.add("frontend-snipper-inspecting");
    document.addEventListener("mouseover", handleMouseMove);
    document.addEventListener("click", selectElement, true);
  }

  function stopInspecting() {
    isInspectActive = false;
    document.body.classList.remove("frontend-snipper-inspecting");
    if (hoveredElement) { hoveredElement.classList.remove("frontend-snipper-hovered"); hoveredElement = null; }
    document.removeEventListener("mouseover", handleMouseMove);
    document.removeEventListener("click", selectElement, true);
    if (window.FrontendSnipperUI) window.FrontendSnipperUI.stopInspect();
  }

  function handleFullPageSnip() {
    performSnip(document.body);
  }

  // -------- Async fetching --------

  function fetchViaBackground(url, as) {
    let credentials = "omit";
    try { if (new URL(url).origin === window.location.origin) credentials = "include"; } catch (e) {}
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: "fetchResource", url: url, as: as, credentials: credentials }, (response) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  // Page-realm fetch (content scripts can read their own page's blob: URLs; the SW cannot).
  async function fetchBlobInPage(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { ok: true, base64: base64, contentType: blob.type || "" };
    } catch (e) { return null; }
  }

  function extractImports(cssText, baseHref) {
    const imports = [];
    const re = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi;
    let m;
    while ((m = re.exec(cssText)) !== null) {
      const url = m[2] || m[4];
      if (url) imports.push(resolveUrl(url, baseHref));
    }
    return imports;
  }

  // Fetch a cross-origin stylesheet's text, inline its @imports, resolve url() against its
  // post-redirect base, and strip directives that are only valid at the top of a file.
  async function fetchSheetCss(url, depth, visited) {
    if (depth > 5 || visited.has(url)) return "";
    visited.add(url);
    const res = await fetchViaBackground(url, "text");
    if (!res || !res.ok || !res.text) return "";
    const base = res.finalUrl || url;

    let importedCss = "";
    const imports = extractImports(res.text, base);
    for (const imp of imports) importedCss += await fetchSheetCss(imp, depth + 1, visited) + "\n";

    let text = res.text.replace(/@charset[^;]+;/gi, "").replace(/@import[^;]+;/gi, "");
    text = resolveCssUrl(text, base);
    return importedCss + text;
  }

  async function resolveMarkers(css, markers, onProgress) {
    if (!markers || !markers.length) return css;
    const visited = new Set();
    let out = css;
    for (let i = 0; i < markers.length; i++) {
      if (onProgress) onProgress(i + 1, markers.length);
      const fetched = await fetchSheetCss(markers[i].href, 0, visited);
      out = out.split(markers[i].marker).join(fetched || "/* external stylesheet unavailable: " + markers[i].href + " */");
    }
    return out;
  }

  // -------- Asset embedding --------

  const MIME_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif",
    "image/webp": ".webp", "image/svg+xml": ".svg", "image/avif": ".avif", "image/bmp": ".bmp",
    "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
    "font/woff2": ".woff2", "font/woff": ".woff", "font/ttf": ".ttf", "font/otf": ".otf",
    "application/font-woff2": ".woff2", "application/font-woff": ".woff",
    "application/x-font-ttf": ".ttf", "application/x-font-otf": ".otf",
    "application/vnd.ms-fontobject": ".eot"
  };

  function extensionFor(contentType, url) {
    const ct = (contentType || "").split(";")[0].trim().toLowerCase();
    if (MIME_EXT[ct]) return MIME_EXT[ct];
    try {
      const path = new URL(url).pathname;
      const dot = path.lastIndexOf(".");
      if (dot !== -1 && dot > path.lastIndexOf("/")) {
        const ext = path.substring(dot).toLowerCase();
        if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
      }
    } catch (e) {}
    return ".bin";
  }

  function collectAssetUrls(html, css) {
    const http = new Set();
    const blobs = new Set();
    const add = (u) => {
      if (!u) return;
      const t = u.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) http.add(t);
      else if (t.startsWith("blob:")) blobs.add(t);
    };
    const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    let m;
    while ((m = urlRe.exec(css)) !== null) add(m[2]);
    while ((m = urlRe.exec(html)) !== null) add(m[2]);
    const srcRe = /\b(?:src|poster)\s*=\s*(['"])([^'"]+)\1/gi;
    while ((m = srcRe.exec(html)) !== null) add(m[2]);
    const srcsetRe = /\bsrcset\s*=\s*(['"])([^'"]+)\1/gi;
    while ((m = srcsetRe.exec(html)) !== null) {
      m[2].split(",").forEach((part) => add(part.trim().split(/\s+/)[0]));
    }
    return { http: Array.from(http), blobs: Array.from(blobs) };
  }

  // Replace a URL only where it is load-bearing: inside url(...), src/poster, or a srcset value.
  function rewriteAssetUrl(text, from, to) {
    const f = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reUrl = new RegExp("(url\\(\\s*['\"]?)" + f + "(['\"]?\\s*\\))", "g");
    const reAttr = new RegExp("((?:src|poster)\\s*=\\s*['\"])" + f + "(['\"])", "gi");
    let out = text.replace(reUrl, "$1" + to + "$2").replace(reAttr, "$1" + to + "$2");
    out = out.replace(/(srcset\s*=\s*)(['"])([\s\S]*?)\2/gi, (m, pre, q, val) => {
      if (val.indexOf(from) === -1) return m;
      return pre + q + val.split(from).join(to) + q;
    });
    return out;
  }

  async function embedAssets(html, css, zip, onProgress) {
    const { http, blobs } = collectAssetUrls(html, css);
    const MAX_ASSETS = 600;
    const MAX_TOTAL_BYTES = 220 * 1024 * 1024;
    const mapping = [];
    let index = 0, processed = 0, totalBytes = 0;
    const all = http.concat(blobs);

    for (const url of all) {
      if (mapping.length >= MAX_ASSETS || totalBytes >= MAX_TOTAL_BYTES) break;
      processed++;
      if (onProgress) onProgress(processed, all.length);
      const res = url.startsWith("blob:") ? await fetchBlobInPage(url) : await fetchViaBackground(url, "base64");
      if (res && res.ok && res.base64) {
        const ext = extensionFor(res.contentType, url);
        const path = "assets/asset_" + (index++) + ext;
        try {
          zip.file(path, res.base64, { base64: true });
          mapping.push([url, path]);
          totalBytes += Math.floor(res.base64.length * 0.75);
        } catch (e) { /* skip */ }
      }
    }

    mapping.sort((a, b) => b[0].length - a[0].length); // longest first (prefix safety)
    let newHtml = html, newCss = css;
    for (const [url, path] of mapping) {
      newHtml = rewriteAssetUrl(newHtml, url, path);
      newCss = rewriteAssetUrl(newCss, url, path);
    }
    return { html: newHtml, css: newCss, embedded: mapping.length, total: all.length };
  }

  // -------- Download --------

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click(); // a throw here propagates to handleDownload, which falls back to the base64 path
    setTimeout(() => {
      try { a.remove(); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 60000);
  }

  async function handleDownload(event) {
    const { html, css, tagName } = event.detail;
    const ctx = lastSnipContext || {};

    if (typeof JSZip === "undefined") {
      alert("JSZip library error: Could not compile files.");
      return;
    }

    if (window.FrontendSnipperUI) {
      window.FrontendSnipperUI.showLoading("Packaging Snippet", "Fetching cross-origin stylesheets...");
    }

    try {
      // 1. Inline any cross-origin stylesheets we couldn't read at snip time.
      let finalCss = await resolveMarkers(css, ctx.markers, (done, total) => {
        if (window.FrontendSnipperUI) {
          window.FrontendSnipperUI.showLoading("Fetching Stylesheets", "Stylesheet " + done + " / " + total + "...");
        }
      });

      const zip = new JSZip();

      // 2. Embed referenced images & fonts (best-effort; falls back to absolute URLs).
      const embedResult = await embedAssets(html, finalCss, zip, (done, total) => {
        if (window.FrontendSnipperUI) {
          window.FrontendSnipperUI.showLoading("Embedding Assets", "Downloaded " + done + " / " + total + " resources...");
        }
      });
      const finalHtml = embedResult.html;
      finalCss = embedResult.css;

      const htmlAttrs = ctx.htmlAttrs || ' lang="en"';
      const title = "Frontend Snippet - " + tagName.toUpperCase();
      const indexHtmlContent =
        "<!DOCTYPE html>\n<html" + htmlAttrs + ">\n<head>\n" +
        '  <meta charset="UTF-8">\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        "  <title>" + title + "</title>\n" +
        '  <link rel="stylesheet" href="styles.css">\n' +
        "</head>\n" + finalHtml + "\n</html>";

      zip.file("index.html", indexHtmlContent);
      zip.file("styles.css", finalCss);
      zip.file("README.txt",
        "Frontend Snipper export\n\n" +
        "Open index.html in a browser to view the captured snippet.\n" +
        "- styles.css contains the page's real stylesheets (inlined verbatim, url()s embedded).\n" +
        "- assets/ holds embedded images and fonts (" + embedResult.embedded + " of " + embedResult.total + " referenced).\n");

      const filename = "snipper_" + tagName.toLowerCase() + ".zip";

      // 3. Deliver as a Blob so large captures download reliably (no data: URL size limit).
      try {
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        triggerBlobDownload(blob, filename);
      } catch (blobErr) {
        const base64String = await zip.generateAsync({ type: "base64" });
        chrome.runtime.sendMessage({ action: "downloadZip", filename: filename, base64Data: base64String }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.success) {
            const msg = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "unknown error";
            alert("Download failed: " + msg);
          }
        });
      }
    } catch (err) {
      console.error("Frontend Snipper: packaging failed:", err);
      alert("Packaging failed: " + (err && err.message ? err.message : err));
    } finally {
      if (window.FrontendSnipperUI) window.FrontendSnipperUI.hideLoading();
    }
  }

  // -------- Lifecycle wiring --------

  if (window.FrontendSnipperListeners) {
    window.removeEventListener("frontend-snipper-start", window.FrontendSnipperListeners.start);
    window.removeEventListener("frontend-snipper-stop", window.FrontendSnipperListeners.stop);
    window.removeEventListener("frontend-snipper-fullpage", window.FrontendSnipperListeners.fullpage);
    window.removeEventListener("frontend-snipper-download", window.FrontendSnipperListeners.download);
  }

  window.FrontendSnipperListeners = {
    start: startInspecting,
    stop: stopInspecting,
    fullpage: handleFullPageSnip,
    download: handleDownload
  };

  window.addEventListener("frontend-snipper-start", startInspecting);
  window.addEventListener("frontend-snipper-stop", stopInspecting);
  window.addEventListener("frontend-snipper-fullpage", handleFullPageSnip);
  window.addEventListener("frontend-snipper-download", handleDownload);

  window.FrontendSnipperCore = {
    start: startInspecting,
    stop: stopInspecting,
    isInspecting: () => isInspectActive,
    snipFullPage: handleFullPageSnip
  };
})();
