// Background Service Worker

// Toggle the side panel when the extension toolbar action icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "toggleSidePanel" }).catch((err) => {
      // Content script might not be injected yet (e.g. on chrome:// pages)
      console.warn("Could not send toggleSidePanel message: ", err);
    });
  }
});

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
});
