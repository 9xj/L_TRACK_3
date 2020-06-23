class Updater {
    constructor() {
        this.errorSleepTime = 500;
        this.updater_pending = false;
        this.messaging = new Messaging();
        this.eventService = undefined;
        this.classwizeEventService = undefined;
        this.pendingEventSource = false;
        this.lastEventMessage = 0;
        this.eventServiceRetryTimeoutSeconds = 1;
    }

    connectToClasswizeEventService = () => {
        let self = this;
        if (self.updater_pending || !config.getClasswizeEventUrl()) {
            return;
        }
        if (config.getCurrentUserInfo() && config.getCurrentUserInfo().user) {
            logging__message("Opening Connection", config.getClasswizeEventUrl());
            self.classwizeEventService = new XMLHttpRequest();
            self.classwizeEventService.timeout = 0;
            self.classwizeEventService.onreadystatechange = function () {
                if (self.classwizeEventService.readyState === 4) {
                    if (self.classwizeEventService.status === 200) {
                        self.updater_pending = false;
                        self.onSuccess(self.classwizeEventService.responseText);
                    } else {
                        self.updater_pending = false;
                        self.onError(self.classwizeEventService.responseText);
                    }
                }
            };
            self.updater_pending = true;
            self.classwizeEventService.open("POST", config.getClasswizeEventUrl(), true);
            self.classwizeEventService.send();
        } else {
            if (self.classwizeEventService === undefined) {
                logging__error("Failed to resolve identity");
            } else {
                logging__warning("Asked to connect when classwize event service was not null");
            }
        }

    };

    onSuccess(responseText) {
        let self = this;
        try {
            logging__message("Received message", responseText);
            self.newEvents(responseText);
        } catch (e) {
            self.onError();
            return;
        }
        self.errorSleepTime = 500;
        window.setTimeout(() => {
            self.connectToClasswizeEventService()
        }, 0);
    }

    onError(response) {
        let self = this;
        self.errorSleepTime *= 2;
        if (self.errorSleepTime > 5000) {
            self.errorSleepTime = 5000
        }
        logging__warning("Poll error; sleeping for " + self.errorSleepTime + "ms", response);
        window.setTimeout(self.connectToClasswizeEventService.bind(self), self.errorSleepTime);
    }

    newEvents(response) {
        if(!config.isClassroomEnabled()){
            return;
        }
        let self = this;
        let jsonMessage = JSON.parse(response);
        if (!jsonMessage.messages) return;
        let events = jsonMessage.messages;
        logging__message("Received events", events);
        for (let event of events) {
            switch (event.event.toUpperCase()) {
                case "MESSAGE":
                    self.handle_event_message(event);
                    break;
                case "OPEN_TAB":
                    self.handle_event_open_tab(event);
                    break;
                case "POLICY_UPDATE":
                    self.handle_event_policy_update(event);
                    break;
                case "CLASS_STARTED":
                    self.handle_event_policy_update();
                    break;
                default:
                    logging__warning("Unknown event: " + message.event, message);

            }
        }
    }

    handle_event_policy_update(event) {
        filtering.reset__verdict_cache();
        configUpdate();

    }

    handle_event_message(event) {
        this.messaging.print_message(event.value, parseFloat(event.timestamp.split(".")[0]));
    }

    handle_event_open_tab(event) {
        let messageContent = event.value;
        if (messageContent.toLowerCase().startsWith("http://") || messageContent.toLowerCase().startsWith("https://")) {
            chrome.tabs.create({url: messageContent});
        } else {
            chrome.tabs.create({url: "http://" + messageContent});
        }
    }


    disconnectClasswizeEventService = () => {
        // if (config.parent_device !== config.device_id) {
        logging__message("Disconnecting Classwize Event Service");
        if (this.classwizeEventService) {
            this.classwizeEventService.abort();
        }
        this.classwizeEventService = undefined;
        this.updater_pending = false;
        // }
    };

    disconnectEventService = () => {
        // if (config.parent_device !== config.device_id) {
        logging__message("Disconnecting from Event Service");
        if (this.eventService) {
            this.eventService.close();
        }
        this.eventService = undefined;
        this.pendingEventSource = false;
        // }
    };

    connectToEventService = () => {
        logging__message("Connecting to Event Service");
        let self = this;
        let device = config.parent_device ? config.parent_device : config.device_id;
        let user = config.getCurrentUserInfo().user;
        if (self.eventService === undefined && !self.pendingEventSource) {
            self.pendingEventSource = true;
            self.eventService = new EventSource(config.eventServiceUrl + "/events/get/topic/agent/device/" + device + "/user/" + user);
            self.eventService.onerror = function (error) {
                logging__error("ERROR WITH EVENT SOURCE", error);
                self.eventServiceRetryTimeoutSeconds *= 2;
                if (self.eventServiceRetryTimeoutSeconds >= 64) {
                    self.eventServiceRetryTimeoutSeconds = 64;
                }

                self.disconnectEventService();
                logging__warning("Event service connect error; sleeping for " + self.eventServiceRetryTimeoutSeconds + "seconds");
                window.setTimeout(self.connectToEventService.bind(self), self.eventServiceRetryTimeoutSeconds*1000);
            };
            self.eventService.onmessage = function (message) {
                self.eventServiceRetryTimeoutSeconds = 1;

                let messages = JSON.parse(message.data);
                logging__debug("Event Message Received", messages);
                for (let message of messages) {
                    console.log("[PING]", message);
                    if (self.lastEventMessage < message["timestamp"]) {
                        if (message["event"] === "CONFIG_UPDATE") {
                            configUpdate();
                            break;
                        }
                    }
                }
                self.lastEventMessage = Date.now() / 1000;
            };
            self.pendingEventSource = false;
        }
    };
}
