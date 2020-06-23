class Filtering {
    constructor() {
        let self = this;
        self.cache = {};
        self.fallback_until = 0;
        self.lastScreenshotTime = 0;
        self.requestTimeSamples = arrayQueue(10);
        chrome.extension.onMessage.addListener(function (request, sender, sendResponse) {
            if (self.shouldCheckFilter(sender)) {
                let url = sender.url;
                let response = "ok";
                let ruleInfo = "?user=" + config.getCurrentUserInfo()["user"] +
                    "&url=" + extractHostname(url) + "&deviceid=" + config.device_id + "&ip=" + config.local_ip + "&cid=" + config.chromeId;

                //Fallback mode - give the all clear to block if needed
                if (request.message === "blockSite") {
                    if (self.isFallback()) {
                        logging__message("Fallback system blocking and redirecting to blocked page");
                        response = "redirect";
                    }

                    sendResponse({
                        message: response,
                        redirectUrl: config.getBlockpageUrl() + ruleInfo
                    });
                }

                //Confirm the site loaded should be allowed
                if (request.message === "checkRequest") {
                let verdict = self.get__verdict(request.url, false);
                if (verdict["verdict"] === 0) {
                    logging__message("Blocked site bypass detected, blocking again.");
                    response = "redirect";
                }

                sendResponse({
                    message: response,
                    redirectUrl: config.getBlockpageUrl() + ruleInfo
                });
                }
            }
        });

        chrome.webRequest.onBeforeRedirect.addListener(
          function (details) {
            logging__message("Redirect caught", details.requestId, details.url, details.redirectUrl);
            verdict_response_store.removeVerdictResponse(details.requestId);
          }, {
              urls: ["<all_urls>"]
          },
          ["extraHeaders", "responseHeaders"]
        );

        chrome.webRequest.onBeforeRequest.addListener(
            (details) => {
                if (self.shouldCheckFilter(details)) {
                    stats.incrementStats("Filtering", "verdictRequests", 1);
                    let verdict = verdict_response_store.getVerdictResponse(details.requestId, details.url);
                    if (!verdict) {
                        verdict = self.get__verdict(details.url, false);
                        verdict_response_store.setVerdictResponse(details.requestId, details.url, verdict);
                    }
                    connections.updateConnectionObject(details);
                    stats.setStats("Filtering", "cacheSize", Object.keys(self.cache).length);
                    let redirectUri = verdict["redirect_uri"];
                    if (redirectUri) {
                        logging__warning("redirect found from verdict!", redirectUri);
                        if (!(redirectUri.toLowerCase().startsWith("http://") || redirectUri.toLowerCase().startsWith("https://"))) {
                            redirectUri = "http://" + redirectUri;
                        }
                        self.redirectRequest = details.requestId;
                        redirectUri += "&cid=" + config.chromeId;
                        return {
                            redirectUrl: redirectUri
                        };
                    }
                    if (verdict["verdict"] === 0) {
                        logging__message("Blocking request and redirecting to blocked page", verdict, details.url);
                        let ruleInfo = "?user=" + config.getCurrentUserInfo()["user"] +
                            "&url=" + extractHostname(details.url) +
                            "&deviceid=" + verdict["deviceid"];
                        ruleInfo += "&ip=" + config.local_ip;
                        ruleInfo += "&cid=" + config.chromeId;
                        if (verdict["rule"]) {
                            ruleInfo += "&rule=" + btoa(verdict["rule"]["name"]);
                            ruleInfo += "&ruleid=" + verdict["rule"]["id"];
                            ruleInfo += "&tagname=" + btoa(verdict["rule"]["criteria"][0]["conditions"][0]["conditions"][0])
                        }
                        return {
                            redirectUrl: config.getBlockpageUrl() + ruleInfo
                        };
                     }else {
                         let bingSafeSearchRedirectUrl = self.enforceBingSafeSearchIfRequired(details.url);
                         if(bingSafeSearchRedirectUrl){
                            logging__message("redirect bing safe search!", bingSafeSearchRedirectUrl);
                             return {
                                 redirectUrl: bingSafeSearchRedirectUrl
                             };
                         }
                     }
                }
            }, {
                urls: ["<all_urls>"]
            },
            ["blocking"]
        );

        chrome.webRequest.onBeforeRequest.addListener(details => {
            if (!config.inside_device_network) {
                if (!config.getAllowInsecureChrome() && !config.getCurrentUserInfo()["token"]) {
                    let tabId = undefined;
                    chrome.tabs.query({}, tabs => {
                        for (let tab of tabs) {
                            if (tab.url === details.url) {
                                tabId = tab.id
                            }
                        }
                    });
                    chrome.identity.getAuthToken({
                        interactive: true
                    }, token => {
                        config.currentUserInfo["token"] = token;
                        let url = self.redirect_mylinewize();
                        chrome.tabs.update(tabId, {
                            url: url
                        });
                    });
                    return {
                        redirectUrl: "about:blank"
                    };
                } else {
                    let url = self.redirect_mylinewize();
                    return {
                        redirectUrl: url
                    };
                }
            }
        }, {
            urls: ["*://my.linewize.net/*"]
        }, ["blocking"]);
    }

    enforceBingSafeSearchIfRequired(url){
        if(url && url.indexOf("bing.") !== -1 && url.indexOf('&adlt=strict') == -1 && (/(\/search|\/videos|\/images|\/news)/.test(url))){
            url += "&adlt=strict"; 
            return url;
        }
    }

    redirect_mylinewize() {
        let redirect_url = "https://mylinewize." + config.active_region + ".linewize.net/login";
        let token = config.getCurrentUserInfo()["token"] ? config.getCurrentUserInfo()["token"] : "";
        redirect_url += "?cid=" + config.chromeId;
        redirect_url += "&ce=true";
        redirect_url += "&u=" + config.getCurrentUserInfo()["user"];
        redirect_url += "&ge=" + config.getCurrentUserInfo()["email"];
        redirect_url += "&d=" + config['device_id'];
        redirect_url += "&gt=" + token;
        return redirect_url
    }

    isFallback() {
        return this.fallback_until > (new Date).getTime();
    }

    shouldCheckFilter(details) {
        let domain = extractHostname(details.url);
        let isBadUrl = domain === extractHostname(config.getVerdictServerUrl())
            || domain.indexOf(".") < 0
            || domain === "localhost"
            || details.url.toLowerCase().startsWith("chrome");
        return details &&
            config.isFilteringEnabled() &&
            !isBadUrl &&
            config.userFound &&
            !(details.initiator && details.initiator.toLowerCase().startsWith("chrome")) &&
            !(this.isFallback());
    }

    get__verdict_from_cache(domain) {
        if (domain in this.cache && this.cache[domain]) {
            return this.cache[domain]
        }
        return undefined;
    }

    reset__verdict_cache() {
        this.cache = {}
    }

    trigger_fallback() {
        //now + 2 minutes
        this.fallback_until = (new Date).getTime() + 120000;
        this.requestTimeSamples = arrayQueue(10);
        logging__warning("Entering Fallback Mode - trying verdict gw again at " + new Date(this.fallback_until));
    }

    get__average_request_time() {
        let total = this.requestTimeSamples.reduce(function (a, b) {
            return a + b;
        }, 0);
        let average_time = total / this.requestTimeSamples.length;
        logging__debug("Average request time: " + average_time);
        if (average_time > 5000) {
            this.trigger_fallback();
        }
        return average_time
    }

    is_bypass(website) {
        let hostname = extractHostname(website);
        if (hostname.includes("linewize.net") && website.includes("bypass_active")) {
            return true;
        }
        return false;
    }

    get__verdict = (website, ignoreTtl) => {
        if (this.is_bypass(website)) {
            this.reset__verdict_cache()
        }

        if (this.lastScreenshotTime + 10 < nowInSeconds()) {
            this.lastScreenshotTime = nowInSeconds();
            tabs.capture_tab_and_send();
        }
        let domain = extractHostname(website);
        if ((website.startsWith("chrome:")
                || domain === extractHostname(config.getVerdictServerUrl())
                || domain.indexOf(".") < 0
            )
            && domain !== "localhost") {
            logging__warning("bad domain:", website);
            return {
                ttl: 999999999
            }
        }
        let path = encodeURIComponent(extractURLPath(website));
        let cacheHit = this.get__verdict_from_cache(domain);
        if (cacheHit && (ignoreTtl || (this.cache[domain].time_retrieved + this.cache[domain].ttl) > nowInSeconds())) {
            stats.incrementStats("Filtering", "cacheHit", 1);
            return cacheHit
        }
        let new_verdict = this.api__get_verdict(domain, path);
        if (!new_verdict) {
            new_verdict = {
                ttl: 5
            };
            logging__warning("Verdict for website was undefined", website, new_verdict);
        }
        new_verdict.time_retrieved = nowInSeconds();
        if (new_verdict.ttl > 0) {
            this.cache[domain] = new_verdict;
        }
        return new_verdict;
    };

    api__get_verdict(website, path) {
        if (this.isFallback()) {
            logging__debug("In Fallback mode, skipping verdict for " + website);
            return undefined;
        }

        logging__debug("Checking verdict for website " + website);

        if (config.getVerdictServerUrl()) {
            let xhr = new XMLHttpRequest();
            let device_param = "";
            if (config.device_id) {
                device_param = "&deviceid=" + config.device_id
            }
            let start_time = (new Date).getTime();
            xhr.open("GET", config.getVerdictServerUrl() + "/get/verdict" +
                "?requested_website=" + website +
                "&identity=" + config.getCurrentUserInfo().user +
                "&identity_type=google" +
                "&chrome_id=" + config.chromeId +
                device_param +
                "&requested_path=" + path,
                false
            );
            let completed_time = start_time;
            try {
                xhr.send();
                if (xhr.status !== 200) {
                    logging__warning("Failed, status was " + xhr.status.toString(), xhr.responseText);
                    completed_time = start_time + (10000); // 10 seconds
                    return undefined;
                }
                let response = JSON.parse(xhr.responseText);
                logging__debug("Got a response for website " + website, response);
                completed_time = (new Date).getTime();
                return response
            } catch (e) {
                logging__error("ERROR", e);
                completed_time = start_time + (10000); // 10 seconds
                return undefined;
            } finally {
                let request_time = completed_time - start_time;
                this.requestTimeSamples.push(Math.min(request_time, 10000));
                this.get__average_request_time();
            }
        }
        return undefined;
    }

}
