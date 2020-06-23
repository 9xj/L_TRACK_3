is_active = function (configuration) {
    let dateTime = new Date();
    let dayOfWeek = dateTime.getDay();
    let minutes = (dateTime.getMinutes() < 10 ? "0" : "") + dateTime.getMinutes();
    let hours = (dateTime.getHours() < 10 ? "0" : "") + dateTime.getHours();
    let time = parseInt(hours + minutes);
    let configActive = config_active(configuration);
    logging__debug("Config Active", configuration, configActive, dayOfWeek, time);
    return configActive
};

safeMapGet = (map, value, defaultValue = undefined) => {
    if (map[value]) {
        return map[value]
    } else {
        return defaultValue
    }
};


extractDomain = (url) => {
    let domain;
    if (url.indexOf("://") > -1) {
        domain = url.split('/')[2];
    } else {
        domain = url.split('/')[0];
    }
    domain = domain.split(':')[0];
    return domain;
};

function extractHostname(url) {
    let hostname;
    if (!url) {
        return undefined;
    }
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("//") > -1) {
        hostname = url.split('/')[2];
    } else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];
    return hostname;
}

nowInSeconds = () => {
    return Math.floor(Date.now() / 1000)
};

function extractURLPath(url) {
    let path;
    let start;

    if (url.indexOf("//") > 0) {

        let offset = url.indexOf("//");
        start = url.indexOf('/', offset + 2);
        if (start > 0) {
            path = url.substring(start + 1);
        }
    } else {
        start = url.indexOf('/');
        if (start > 0) {
            path = url.substring(url.indexOf('/') + 1);
        }
    }

    if (start < 0) {
        path = "";
    }

    if (path.slice(-1) == "/") {
        path = path.slice(0, -1);
    }

    return path;
}

extractPort = function (url) {
    let port = Number(extractRequestUri(url).split("/")[0].replace(":", ""));
    if (!isNaN(port) && port > 0) {
        return port
    }
    if (url.startsWith("https")) {
        return 443
    }
    if (url.startsWith("http")) {
        return 80
    }
    if (url.startsWith("ftp")) {
        return 21
    }
    return 0
};

extractRequestUri = function (url) {
    let domain = extractHostname(url);
    return url.substring(url.indexOf(domain) + domain.length)
};

config_active = function (configuration) {
    let now = nowInSeconds();
    if (configuration.timeout !== 0 && configuration.timeout > now) {
        return true;
    }

    for (let period of configuration.periods) {
        let dateTime = new Date();
        let dayOfWeek = dateTime.getDay();
        let minutes = (dateTime.getMinutes() < 10 ? "0" : "") + dateTime.getMinutes();
        let hours = (dateTime.getHours() < 10 ? "0" : "") + dateTime.getHours();
        let time = parseInt(hours + minutes);
        if (dayOfWeek === 0 && period.day === "sun") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 1 && period.day === "mon") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 2 && period.day === "tue") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 3 && period.day === "wed") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 4 && period.day === "thur") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 5 && period.day === "fri") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
        if (dayOfWeek === 6 && period.day === "sat") {
            if (time >= period.startTime && time <= period.endTime) {
                return true;
            }
        }
    }

    return false;
};

getStorage = function (key, callback) {
    chrome.storage.local.get([key], function (result) {
        callback(result)
    })
};

resetStorage = function () {
    chrome.storage.local.clear();
};

updateStorage = function (key, value, callback = () => {}) {
    chrome.storage.local.get([key], function (result) {
        if (Object.keys(result).length === 0) {
            result.key = {}
        }
        let connections = {};
        connections[key] = value;
        chrome.storage.local.set(connections, callback);
    })
};

roughSizeOfObject = function (object) {
    let objectList = [];
    let stack = [object];
    let bytes = 0;

    while (stack.length) {
        let value = stack.pop();
        if (typeof value === 'boolean') {
            bytes += 4;
        } else if (typeof value === 'string') {
            bytes += value.length * 2;
        } else if (typeof value === 'number') {
            bytes += 8;
        } else if (value.byteLength > 0) {
            bytes += value.byteLength;
        } else if
        (
            typeof value === 'object'
            && objectList.indexOf(value) === -1
        ) {
            objectList.push(value);

            for (let i in value) {
                stack.push(value[i]);
            }
        }
    }
    return bytes;
};

arrayQueue = function (length) {
    let array = [];
    array.push = function () {
        if (this.length >= length) {
            this.shift();
        }
        return Array.prototype.push.apply(this, arguments);
    };
    return array;
};

function getUserIP(newIpCallback) {
    //compatibility for firefox and chrome
    var myPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
    var pc = new myPeerConnection({
            iceServers: []
        }),
        noop = function () {
        },
        ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/g;

    //create a bogus data channel
    pc.createDataChannel("");

    // create offer and set local description
    pc.createOffer().then(function (sdp) {
        sdp.sdp.split('\n').forEach(function (line) {
            if (line.indexOf('candidate') < 0) {
                return;
            }
            let ip_address = line.match(ipRegex)[0];
            /**********************************************************************************
             * Android on Chrome OS uses a bridged interface br0 at IP 100.115.92.0/24        *
             * (probably 100.115.92.1, check with ifconfig) to provide network separation     *
             * between Android and Chrome OS. I suspect AI2 Companion wants the computer and  *
             * device on the same subnet.                                                     *
             * -- REF: https://www.reddit.com/r/chromeos/comments/6cxs8w/ai2_companion_on_cb/ *
             **********************************************************************************/
            if (ip_address.startsWith("100.115.92")) {
                ip_address = "10.255.255.254"
            }
            newIpCallback(ip_address);
        });
        pc.setLocalDescription(sdp, noop, noop);
    }).catch(function (reason) {
        // An error occurred, so handle the failure to connect
    });

    //listen for candidate events
    pc.onicecandidate = function (ice) {
        if (ice && ice.candidate && ice.candidate.candidate && ice.candidate.candidate.match(ipRegex)) {
            let ip_address = ice.candidate.candidate.match(ipRegex)[0];
            /*********************
             * See above comment *
             *********************/
            if (ip_address.startsWith("100.115.92")) {
                ip_address = "10.255.255.254"
            }
            newIpCallback(ip_address);
        }
    };
}
