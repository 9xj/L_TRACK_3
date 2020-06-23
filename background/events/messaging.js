class Messaging {

    add_message_container() {
        chrome.tabs.executeScript(null, {
            code: "" +
                "    if (document.getElementById(\"linewize-message-container\") == null) {\n" +
                "        var messageContainer = document.createElement('div');\n" +
                "        messageContainer.style = \"position: fixed;\" +\n" +
                "            \"width: 100%;\" +\n" +
                "            \"z-index: 999999999999;\" +\n" +
                "            \"overflow-x: hidden;\" +\n" +
                "            \"text-align: center;\" +\n" +
                "            \"top: 0;\" +\n" +
                "            \"min-height: unset;\" +\n" +
                "            \"height: unset;\" +\n" +
                "            \"font-family: unset;\"\n" +
                "        messageContainer.id = \"linewize-message-container\";\n" +
                "        document.body.appendChild(messageContainer);\n" +
                "    }"
        });
    }

    add_fade_functions() {
        chrome.tabs.executeScript(null, {
            code: "    var fadeInSide = function (divElement) {\n" +
                "        setTimeout(function () {\n" +
                "            divElement.style.marginLeft = \"0\";\n" +
                "            divElement.style.opacity = \"0.8\";\n" +
                "        }, 500);\n" +
                "    };\n" +
                "    var fadeOutSide = function (divElement) {\n" +
                "        divElement.addEventListener(\"transitionend\", event => {\n" +
                "            divElement.remove()\n" +
                "        }, false);\n" +
                "        divElement.style.marginLeft = \"100%\";\n" +
                "        divElement.style.opacity = \"0\";\n" +
                "    };"
        });
    }


    print_message(message, timestamp) {
        let self = this;
        logging__message("Printing", message, timestamp);
        message = message.split("\n").join('&#xA;');
        self.add_message_container();
        self.add_fade_functions();
        chrome.tabs.executeScript(null, {
            code:
                "if (document.getElementById(\"linewize-message-container\") != null) {\n" +
                "        let message_container = document.getElementById(\"linewize-message-container\");\n" +
                "        let divElement = document.createElement(\"div\");\n" +
                "        let messageElementId = \"message-" + timestamp + "\";\n" +
                "        let messageDuration = 300000;\n" +
                "\n" +
                "        divElement.id = messageElementId;\n" +
                "        divElement.className = \"message-element\";\n" +
                "        divElement.style = \"width:100%;\" +\n" +
                "            \"               padding:20px;\" +\n" +
                "            \"               color:#FFF;\" +\n" +
                "            \"               opacity:0.0;\" +\n" +
                "            \"               margin-top:0px;\" +\n" +
                "            \"               margin-left:-100%;\" +\n" +
                "            \"               min-height: unset;\" +\n" +
                "            \"               height: unset;\" +\n" +
                "            \"               font-size: 12px;\" +\n" +
                "            \"               font-family: monospace;\" +\n" +
                "            \"               background:#000;\";\n" +
                "        divElement.style.transition = \"opacity 1s, margin-left 1s ease-in-out\";\n" +
                "        let timeElement = document.createElement(\"div\");\n" +
                "        timeElement.style = \"float:left; margin-left: 10px;\";\n" +
                "        let messageDate = new Date(" + timestamp + "*1000);\n" +
                "        let messageAmPm = messageDate.getHours() >= 12 ? \"pm\" : \"am\";\n" +
                "        timeElement.innerHTML += (messageDate.getHours() % 12 == 0 ? 12 : messageDate.getHours() % 12) + \":\" + " +
                "                                   (messageDate.getMinutes() < 10 ? \"0\" + messageDate.getMinutes() : messageDate.getMinutes()) + messageAmPm;\n" +
                "        divElement.appendChild(timeElement);\n" +
                "\n" +
                "        let messageElement = document.createElement(\"span\");\n" +
                "        messageElement.style = \"word-wrap: break-word; width: calc(100% - 150px);display:inline-block;white-space:pre-wrap;text-align:center\";\n" +
                "        messageElement.innerHTML += \"" + message + "\";\n" +
                "        divElement.appendChild(messageElement);\n" +
                "\n" +
                "        let closeElement = document.createElement(\"div\");\n" +
                "        closeElement.onclick = function(){divElement.remove()};\n" +
                "        closeElement.style = \"float:right; margin-right: 40px; cursor: pointer\";\n" +
                "        closeElement.innerHTML += \"x\";\n" +
                "        divElement.appendChild(closeElement);\n" +
                "        message_container.appendChild(divElement);\n" +
                "        fadeInSide(divElement);\n" +
                "        setTimeout(function() {\n" +
                "            fadeOutSide(divElement)\n" +
                "        }, messageDuration);\n" +
                "    }"
        });
    };
}