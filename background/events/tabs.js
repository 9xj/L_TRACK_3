class Tabs {

    constructor() {
        this.activeConfigurations = [];
        this.focus_group = [];
        this.lock_user = false;
        this.previousTabsUrls = [];

    }

    capture_active_tab(callback) {
        try {
            chrome.tabs.captureVisibleTab(null, {format: 'jpeg', quality: 50}, function (img) {
                let sourceImage = new Image();
                let width = 300;
                sourceImage.onload = function () {
                    if (sourceImage.width > width) {
                        let oc = document.createElement('canvas'), octx = oc.getContext('2d');
                        oc.width = sourceImage.width;
                        oc.height = sourceImage.height;
                        octx.drawImage(sourceImage, 0, 0);
                        while (oc.width * 0.5 > width) {
                            oc.width *= 0.5;
                            oc.height *= 0.5;
                            octx.drawImage(oc, 0, 0, oc.width, oc.height);
                        }
                        oc.width = width;
                        oc.height = oc.width * sourceImage.height / sourceImage.width;
                        octx.drawImage(sourceImage, 0, 0, oc.width, oc.height);
                        callback(oc.toDataURL());
                    } else {
                        callback(sourceImage.src);
                    }
                };
                sourceImage.src = img;
            });
        } catch {
        }
    }

    capture_tab_and_send() {
        let self = this;
        if (this.activeConfigurations.length === 0 || !config.isClassroomEnabled()) {
            return
        }
        logging__message("Capturing Tab");
        let segment = {
            "title": "",
            "url": "",
            "favicon": "",
            "tab_id": "",
            "chrome_id": "",
            "action": "",
            "screenshot": ""
        };
        chrome.windows.getAll((windows) => {
            windows = windows.map((window) => {
                return window["id"]
            });
            chrome.tabs.query({currentWindow: true}, (allTabs) => {
                    logging__message("chrome.tabs.query operating ", allTabs);
                    let otherTabs = [];
                    for (let i = 0; i < allTabs.length; i++) {
                        let tab = allTabs[i];
                        if (tab["active"]) {
                            segment["tab_id"] = tab["windowId"] + "_" + tab["id"];
                            segment["chrome_id"] = config.chromeId;
                            segment["chrome_window_id"] = windows.indexOf(tab["windowId"]) === -1
                                ? tab["windowId"]
                                : windows.indexOf(tab["windowId"]);
                            segment["action"] = "upsert";
                            segment["title"] = tab["title"];
                            segment["url"] = tab["url"];
                            segment["favicon"] = tab["favIconUrl"];
                        } else {
                            otherTabs.push({"favIcon": tab["favIconUrl"], "tabUrl": tab["url"], "title": tab["title"]});
                        }
                    }
                    segment["background_tabs"] = otherTabs;
                    if (!segment["url"].toLowerCase().startsWith("chrome")) {
                        self.capture_active_tab(function (img) {
                            logging__message("chrome.tabs.query about to call sendToLinewize");
                            segment["screenshot"] = img;
                            for (let configuration of self.activeConfigurations) {
                                if (is_active(configuration)) {
                                    segment["email"] = configuration["identity"];
                                    let xhr = new XMLHttpRequest();
                                    xhr.open("POST", configuration["endpoint"], true);
                                    xhr.setRequestHeader("Content-Type", "application/json");
                                    xhr.onreadystatechange = function () {
                                        if (xhr.readyState === 4) {
                                            segment.screenshot = "";
                                            if (xhr.status === 200) {
                                                logging__message("Uploaded screen shot of tab", segment);
                                            } else {
                                                logging__error("Failed to upload screen shot of tab", segment);
                                            }
                                        }
                                    };
                                    xhr.send(JSON.stringify(segment));
                                }
                            }
                        });
                    }
                }
            );
        });
    }

    tab_removed(tabId) {
        for (let configuration of this.activeConfigurations) {
            if (is_active(configuration)) {
                let segment = {
                    "email": configuration["identity"],
                    "tab_id": tabId,
                    "action": "remove"
                };
                let xhr = new XMLHttpRequest();
                xhr.open("POST", configuration["endpoint"], true);
                xhr.setRequestHeader("Content-Type", "application/json");
                xhr.send(JSON.stringify(segment));
            }
        }
    }

    focus_tabs() {
        if(!config.isClassroomEnabled()){
           return;
        }
        let self = this;
        if (this.activeConfigurations.length === 0) {
            if (this.previousTabsUrls.length > 0) {
                this.restore_tabs();
                logging__message("Focus deactivated, restoring previous tabs");
            }
            return
        }

        for (let configuration of this.activeConfigurations) {
            let configActive = is_active(configuration);
            if (configActive) {
                // Focus handling
                if (configuration.apply_focus && configuration.focus_urls && configuration.focus_urls.length > 0) {
                    // focus urls available so we must be in focus mode
                    if (self.focus_group.length === 0) {
                        logging__message("Focus activated");

                        // no focus for a group configured yet, lets do it
                        self.focus_group = configuration.group;
                        this.add_tabs(configuration.focus_urls);
                        this.restrict_tabs(configuration.focus_urls);
                        setTimeout(this.prevent_new_tab, 1000);
                        break;
                    } else if (self.focus_group === configuration.group) {
                        // potentially update focus urls
                        this.allow_new_tabs();
                        setTimeout(() => {
                            this.add_tabs(configuration.focus_urls);
                            this.restrict_tabs(configuration.focus_urls);
                            setTimeout(this.prevent_new_tab, 1000)
                        }, 1000);
                        break;
                    }
                } else {
                    if (self.focus_group.length > 0 && self.focus_group === configuration.group) {
                        logging__message("Focus deactivated, restoring previous tabs");
                        // reset after group came out of focus
                        self.focus_group = [];
                        this.allow_new_tabs();
                        this.restore_tabs();
                        break;
                    }
                }
                // Lock handling
                if (config.getLockUrl() && configuration.locked_users) {
                    if (configuration.locked_users.length > 0) {
                        if (!self.lock_user && configuration.locked_users.indexOf(configuration.identity) >= 0) {
                            logging__message("Lock activated");
                            self.lock_user = true;
                            this.add_tabs([config.getLockUrl()]);
                            this.restrict_tabs([config.getLockUrl()]);
                            setTimeout(this.prevent_new_tab, 1000);
                            setTimeout(this.prevent_navigation, 1000);

                        } else if (self.lock_user && configuration.locked_users.indexOf(configuration.identity) < 0) {
                            logging__message("Lock deactivated");
                            self.lock_user = false;
                            this.allow_new_tabs();
                            this.cleanup_tabs([config.getLockUrl()]);
                            this.allow_navigation();
                            this.restore_tabs();
                        }
                    } else if (self.lock_user) {
                        logging__message("Lock deactivated");
                        self.lock_user = false;
                        this.allow_new_tabs();
                        this.cleanup_tabs([config.getLockUrl()]);
                        this.allow_navigation();
                        this.restore_tabs();
                    }
                }
            }
        }
    }

    cleanup_tabs(unwanted_urls) {
        chrome.tabs.query({}, tabs => {
            for (let tab of tabs) {
                for (let url of unwanted_urls) {
                    if (tab.url.indexOf(url) >= 0) {
                        chrome.tabs.remove(tab.id);
                    }
                }
            }
        });
    }

    restrict_tabs(allowed_urls) {
        chrome.tabs.query({}, tabs => {
            tabLoop:
                for (let tab of tabs) {
                    for (let url of allowed_urls) {
                        if (tab.url.indexOf(url) >= 0) {
                            // this tab url is part of the focus - don't remove it
                            continue tabLoop;
                        }
                    }
                    this.previousTabsUrls.push(tab.url);
                    chrome.tabs.remove(tab.id);
                }
        });
    }

    add_tabs(urls) {
        chrome.tabs.query({}, tabs => {
            urlLoop:
                for (let url of urls) {
                    for (let tab of tabs) {
                        if (tab.url.indexOf(url) >= 0) {
                            // this tab url is part of the focus - no need to add it again
                            continue urlLoop;
                        }
                    }
                    let protocol = "";
                    if (url.indexOf("http") !== 0) {
                        protocol = "http://"
                    }
                    chrome.tabs.create({url: protocol + url});
                }
        });
    }

    restore_tabs() {
        for (let url of this.previousTabsUrls) {
            chrome.tabs.create({url: url})
        }
        this.previousTabsUrls.length = 0;
    }

    prevent_navigation_handler(details) {
        if (details.url.indexOf("linewize.net") >= 0) {
            return {}
        }
        return {redirectUrl: config.getLockUrl()};
    }

    prevent_navigation() {
        if (!chrome.webRequest.onBeforeRequest.hasListener(this.prevent_navigation_handler)) {
            chrome.webRequest.onBeforeRequest.addListener(this.prevent_navigation_handler,
                {urls: ["<all_urls>"]}, ["blocking"])
        }
    }

    allow_navigation() {
        if (chrome.webRequest.onBeforeRequest.hasListener(this.prevent_navigation_handler)) {
            chrome.webRequest.onBeforeRequest.removeListener(this.prevent_navigation_handler)
        }
    }

    prevent_new_tab() {
        if (!chrome.tabs.onCreated.hasListener(remove_new_tab_handler)) {
            chrome.tabs.onCreated.addListener(remove_new_tab_handler)
        }
    }

    allow_new_tabs() {
        if (chrome.tabs.onCreated.hasListener(remove_new_tab_handler)) {
            chrome.tabs.onCreated.removeListener(remove_new_tab_handler)
        }
    }

    updateActiveConfigurations(activeConfigurations) {
        this.activeConfigurations = activeConfigurations;
        this.focus_tabs();
    }
}

let remove_new_tab_handler = tab => {
    chrome.tabs.query({}, tabs => {
        if (tabs.length <= 1) {
            return;
        }
        chrome.tabs.remove(tab.id);
    })
};


