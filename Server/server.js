let WebSocketServer = require('ws').Server;
let irc = require('irc');
let fs = require('fs')

function loadConfig() {
    let data = fs.readFileSync('./config.json');
    let config = JSON.parse(data.toString());
    return config;
}

function socketVerify(info) {
    return true;
}

function parseCookie(cookie) {
    let cookieObject = {};
    let props = cookie.split(';');
    for (let prop of props) {
        prop = prop.trim();
        let pair = prop.split('=');
        cookieObject[pair[0].trim()] = pair[1].trim();
    }
    return cookieObject;
}

function startServer(config) {
    let ircClient = new irc.Client('irc.ppy.sh', config.ircBotName, {
        port: 6667,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    let ws = new WebSocketServer({
        port: 80,
        noServer: true,
        verifyClient: socketVerify,
        path: '/osu_bot'
    });

    let onlineUsers = new Map();
    let onlineUsersForUsername = new Map();

    ircClient.connect();
    ircClient.addListener('message', function (from, to, message) {
        console.debug(`[IRC to Sync]User: ${from}, Message: ${message}`);
        var user = onlineUsersForUsername.get(to);
        user.websocket.send(message,{bbinary:false});
    });

    ws.on('connection',
        function (wsocket, request) {
            let cookie = parseCookie(request.headers.cookie);
            let user = {
                websocket: wsocket,
                ircTargetUsername: cookie.transfer_target_name
            };

            wsocket.on('message', (msg) => onMessage(onlineUsers.get(wsocket), msg));
            wsocket.on('error', onError);
            wsocket.on('close', () => {
                onlineUsers.delete(wsocket);
                onlineUsersForUsername.delete(user.ircTargetUsername);
                console.log(`Online User Count: ${onlineUsers.size}`);
            });

            onlineUsers.set(wsocket, user);
            onlineUsersForUsername.set(user.ircTargetUsername,user);

            if (config.welcomeMessage != null && config.welcomeMessage != "")
                ircClient.say(user.ircTargetUsername, config.welcomeMessage);

            console.log(`Online User Count: ${onlineUsers.size}`);
        });

    function onMessage(user, msg) {
        console.debug(`[Sync to IRC]User: ${user.ircTargetUsername}, Message: ${msg}`);
        ircClient.say(user.ircTargetUsername, msg);
    }

    function onError(err) {
        console.error(err);
    }
}

config = loadConfig();
startServer(config);