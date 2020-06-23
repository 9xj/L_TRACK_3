let updater = new Updater();
let config = new Config();
let tabs = new Tabs();
let verdict_response_store = new VerdictResponseStore(30);
let connections = new Connections();
let filtering = new Filtering();
let stats = new Stats();
let login = new Login();
let loadingConfig = false;
let lastIpAddress = "0.0.0.0";
let isPlatformChromeOs = false;

addListeners = () => {

    let lastScreenshotTime = 0;
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        logging__message("chrome.tabs.onUpdated called with tab status", changeInfo["status"]);
        if(config.isClassroomEnabled()){
            //always send screenshot when tab loading is complete otherwise send it once every 10 seconds
            if(changeInfo["status"] === "complete"){
                tabs.capture_tab_and_send();
            }else if (lastScreenshotTime + 10 < nowInSeconds()){ 
                lastScreenshotTime = nowInSeconds();
                tabs.capture_tab_and_send();
            }
        }
    });

    chrome.identity.onSignInChanged.addListener(() => {
        logging__warning("Google Identity Changed");
        setTimeout(() => {
            configUpdate(true);
        }, 3000);
    });

    chrome.tabs.onActivated.addListener(() => {
        if (config.isClassroomEnabled()) {
            logging__message("chrome.tabs.onActivated called");
            tabs.capture_tab_and_send();
        }
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        if (config.isFilteringEnabled()) {
            tabs.tab_removed(removeInfo["windowId"] + "_" + tabId, config.getActiveConfigurations());
        }
    });

    chrome.extension.onMessage.addListener((request, sender, sendResponse) => {
        if (request.greeting === "GetStatus") {
            let response = {
                disabled: config.isExtensionDisabled(),
                chrome_user: config.getCurrentUserInfo().user,
                user_information: config.userInformation,
                extension_login: config.google_classroom_extension_login,
                loading: loadingConfig,
                appliance: {
                    device_id: config.device_id,
                    parent_device: config.parent_device,
                    local_device: config.local_device,
                    inside_network: config.inside_device_network,
                    authenticated: config.inside_device_network__authenticated,
                    network_user: config.inside_device_network__user
                },
                features: {
                    Filtering: config.isFilteringEnabled(),
                    Connections: config.isConnectionReportingEnabled(),
                    Classroom: config.isClassroomEnabled(),
                    ChromebookOnly: config.enable_extension_chromebooks_only
                },
                classes: []
            };

            if (config.getActiveConfigurations().length > 0) {
                for (let configuration of config.getActiveConfigurations()) {
                    if (is_active(configuration)) {
                        response.classes.push({
                            classroom_name: configuration.group_label || configuration.group,
                            teacher_information: safeMapGet(configuration, "teacher_information", null),
                            focused: config.isClassroomEnabled() && configuration.apply_focus,
                            locked: config.isClassroomEnabled() && configuration.locked_users.indexOf(configuration.identity) >= 0
                        });
                    }
                }
            }

            sendResponse(response);
        } else if (request.greeting === "ReloadConfig") {
            configUpdate(true);
        }
    });
};

hasActiveClass = () => {
    if (config.getActiveConfigurations().length > 0) {
        for (let configuration of config.getActiveConfigurations()) {
            if (is_active(configuration)) {
                return true;
            }
        }
    }

    return false;
};

configUpdate = (allowRetry = false) => {
    logging__message("Starting Config Update");
    if (loadingConfig) {
        logging__message("Config was updating, bombing out");
        return;
    }
    loadingConfig = true;
    let configLoadTimeout = setTimeout(() => {
        logging__error("Config Timeout");
        loadingConfig = false;
        if (allowRetry) {
            setTimeout(() => {
                configUpdate(false);
            }, 5000);
        }
    }, 10000);
    let hadActiveClassBeforeUpdate = hasActiveClass();
    chrome.extension.sendMessage({greeting: "ReloadingPopup"});
    config.retrieve_configuration((e) => {
            logging__error("Error retrieving config", e, allowRetry);
            loadingConfig = false;
            if (allowRetry) {
                setTimeout(() => {
                    configUpdate(false);
                }, 5000);
            }
        },
        () => {
            clearTimeout(configLoadTimeout)
        },
        updater.disconnectClasswizeEventService.bind(updater),
        updater.connectToClasswizeEventService.bind(updater),
        updater.disconnectEventService.bind(updater),
        updater.connectToEventService.bind(updater),
        tabs.updateActiveConfigurations.bind(tabs),
        config.updateSavedSettings.bind(config),
        () => {
            if (!hadActiveClassBeforeUpdate && hasActiveClass()) {
                logging__message("Class was not active before, now it is, asking for all screenshots", config);
                tabs.capture_tab_and_send()
            }
            logging__message("config.retrieve_configuration finished, about to call loginLook callback", config);
            login.login();
            chrome.extension.sendMessage({greeting: "ReloadPopup"});
        },
        () => {
            loadingConfig = false; //Keep me last!
        });
};


addListeners();


getUserIP((ip_address) => {
    if (!loadingConfig && /\d+\.\d+\.\d+\.\d+/.test(ip_address)) {
        logging__warning("Changed networks", ip_address, lastIpAddress);
        let region = config.active_region;
        config = new Config();
        config.active_region = region;
        config.setLocalIpAddress(ip_address);
        lastIpAddress = ip_address;
        if (ip_address !== "0.0.0.0") {
            configUpdate(true);
        }
    }
});

interval_login = setInterval(function () {
    login.login();
}, 600000);

whoami_login = setInterval(function () {
    config.updateDeviceLocation((
        network_identity_provided,
        provider_username,
        provided_device_id,
        provided_region) => {
        if (config.currentUserInfo.user !== provider_username) {
            logging__warning("User changed via network");
            configUpdate(true);
        }
    });
}, 180000);

fzbox_poll = setInterval(function () {
    //if extension is disabled we should not send probe to sphirewall to allow filtering by sphirewall
    if(config.isExtensionDisabled()){
        return;
    }
    
    let xhr = new XMLHttpRequest();
    xhr.open("GET", "http://fzbox.tools", true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4)
            return;

        if (config.lastFZProbeCode !== xhr.status) {
            logging__warning("[http://fzbox.tools] Network safety changed:", xhr.status === 200 ? "Current network is safe" : "Current network is unsafe");
            config.lastFZProbeCode = xhr.status;
            configUpdate(true);
            return
        }

        try {
            let networkProvider = "UNKNOWN";
            if (xhr.getResponseHeader("Content-type") && xhr.getResponseHeader("Content-type").includes("application/json")) {
                networkProvider = JSON.parse(xhr.responseText)["provider"];
            }

            if (config.lastFZProbeProvider !== networkProvider) {
                logging__warning("[http://fzbox.tools] Network provider changed:", networkProvider);
                config.lastFZProbeProvider = networkProvider;
                configUpdate(true);
            }
        } catch (e) {
            logging__error("Encountered error while parsing network information", e)
        }
    };
    xhr.send();
}, 60000);

//check if OS of device is chrome OS
//https://developer.chrome.com/extensions/runtime#type-PlatformOs
chrome.runtime.getPlatformInfo((platformInfo) => {
    isPlatformChromeOs = (platformInfo.os === "cros");
}); 
