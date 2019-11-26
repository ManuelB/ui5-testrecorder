var bInitialized = false;
var bNextImmediateStart = false;

chrome.browserAction.onClicked.addListener(function (tab) {
	"use strict";
	createAndStart(tab, false);
});

function createAndStart(tab, bStartSelectImmediate) {
	"use strict";
	//var sOurTabId = tab.id;
	//var sOurWindowId = 0;
	bNextImmediateStart = bStartSelectImmediate;

	/*
	chrome.tabs.onRemoved.addListener(function (tabId, info) {
		if (tabId === sOurTabId) {
			chrome.windows.remove(sOurWindowId);
		}
	}.bind(this));
	*/

	chrome.tabs.create({
		url: chrome.extension.getURL('/scripts/popup/index.html'),
		active: false
	}, function (tab) {
		chrome.windows.create({
			tabId: tab.id,
			type: 'popup',
			focused: true
		}, function (fnWindow) {
			// sOurWindowId = fnWindow.id;
			if (bInitialized === false) {
				bInitialized = true;
				chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
					if (message.type === "handshake-get-window-id") {
						sendResponse({
							"type": "handshake-send-window-id",
							"windowId": sender.tab.windowId,
							"startImmediate": bNextImmediateStart
						});
					}
				});
			}
		});
	});
}
