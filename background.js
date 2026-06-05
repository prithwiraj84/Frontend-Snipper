// Background Service Worker

// Briefly flash the toolbar badge to signal a state to the user.
function flashBadge(tabId, text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: color || "#EF4444", tabId });
    chrome.action.setBadgeText({ text: text, tabId });
    setTimeout(() => {
      try { chrome.action.setBadgeText({ text: "", tabId }); } catch (e) {}
    }, 2500);
  } catch (e) {}
}

// The content-script bundle, mirrored from manifest.json content_scripts so we can inject it
// on demand when a tab predates the (re)loaded extension.
const CONTENT_JS = ["libs/jszip.min.js", "content/ui.js", "content/snipper.js"];
const CONTENT_CSS = ["content/theme.css"];

// Toggle the panel. First try to message an already-present content script (preserves panel
// state). If it isn't reachable — the classic case where the extension was reloaded but the tab
// wasn't, or static injection raced — inject the scripts on demand and retry. Only genuinely
// restricted pages (chrome://, the Web Store, view-source:, the new-tab page) can't be injected.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggleSidePanel" });
    return; // content script was present and handled it
  } catch (err) {
    // Not reachable — fall through to on-demand injection.
  }

  try {
    // CSS first (best-effort; harmless if already applied), then the JS bundle.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: CONTENT_CSS });
    } catch (cssErr) { /* may already be present */ }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_JS });

    // executeScript resolves after the scripts finish running, so the message listener is now
    // registered. Retry the toggle.
    await chrome.tabs.sendMessage(tab.id, { action: "toggleSidePanel" });
  } catch (injectErr) {
    console.warn("Frontend Snipper can't run on this page:", injectErr && injectErr.message ? injectErr.message : injectErr);
    flashBadge(tab.id, "—", "#71717A");
  }
});

// Max bytes we are willing to inline for a single asset (15 MB).
const MAX_ASSET_BYTES = 15 * 1024 * 1024;

// Convert an ArrayBuffer to a base64 string without blowing the call stack on large buffers.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32k chars per chunk
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Fetch a resource cross-origin from the privileged background context (bypasses page CORS
// because the extension holds host_permissions for <all_urls>). Returns text or base64.
// `credentials` defaults to 'omit' so we fetch the PUBLIC variant of third-party assets and
// never leak the user's cookies to CDNs/font hosts; the content script opts into 'include'
// only for same-origin resources that may sit behind auth.
async function fetchResource(url, as, credentials) {
  const response = await fetch(url, {
    credentials: credentials === "include" ? "include" : "omit",
    redirect: "follow"
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  const contentType = response.headers.get("content-type") || "";
  // The final URL after any redirects — callers resolve relative url() against this.
  const finalUrl = response.url || url;

  if (as === "text") {
    const text = await response.text();
    return { ok: true, contentType, finalUrl, text };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, status: "too-large", byteLength: buffer.byteLength };
  }
  return { ok: true, contentType, finalUrl, base64: arrayBufferToBase64(buffer), byteLength: buffer.byteLength };
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadZip") {
    const { filename, base64Data } = message;

    chrome.downloads.download({
      url: `data:application/zip;base64,${base64Data}`,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`Download started with ID: ${downloadId}`);
        sendResponse({ success: true, downloadId });
      }
    });

    // Return true to indicate we will respond asynchronously
    return true;
  }

  if (message.action === "fetchResource") {
    fetchResource(message.url, message.as || "base64", message.credentials)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));

    // Return true to indicate we will respond asynchronously
    return true;
  }
});
