let WebSocketServer = require('ws').Server;
let irc = require('irc');
let fs = require('fs')
let readline = require('readline');

let oldLog = console.log;
let oldError = console.error;
let oldDebug = console.debug;

console.log = function (msg) {
    oldLog(`[${new Date().toLocaleTimeString()}] [Log] ${msg}`);
}

console.error = function (msg) {
    oldError(`[${new Date().toLocaleTimeString()}] [Error] ${msg}`)
}

console.debug = function (msg) {
    oldDebug(`[${new Date().toLocaleTimeString()}] [Debug] ${msg}`)
}

function loadConfig() {
    let data = fs.readFileSync('./config.json');
    let config = JSON.parse(data.toString());
    return config;
}

function socketVerify(info,config) {
    let cookie = parseCookie(info.req.headers.cookie);
    if (cookie.transfer_target_name === undefined)
        return false;
    if(cookie.transfer_target_name.indexOf("#") != -1)
        return false;
    if(cookie.transfer_target_name === config.ircBotName)
        return false;
    return true;
}

function parseCookie(cookie) {
    let cookieObject = {};
    if (cookie !== undefined) {
        let props = cookie.split(';');
        for (let prop of props) {
            prop = prop.trim();
            let pair = prop.split('=');
            cookieObject[pair[0].trim()] = pair[1].trim();
        }
    }
    return cookieObject;
}

function startServer(config) {
    const CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
    const CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
    const CONST_HEART_CHECK_TIMEOUT = 30 * 1000;//30s
    const CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL = 60 * 1000//60s
    const CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL = 30 * 60 * 1000;//30m

    let ircClient = new irc.Client('irc.ppy.sh', config.ircBotName, {
        port: 6667,
        autoConnect: true,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    let ws = new WebSocketServer({
        port: config.port,
        noServer: true,
        verifyClient: (info)=>socketVerify(info,config),
        path: config.path
    });

    let onlineUsers = new Map();
    let onlineUsersForUsername = new Map();

    //irc event
    ircClient.addListener('registered', (msg) => console.log(`[IRC] Connected! MSG:${JSON.stringify(msg)}`));
    ircClient.addListener('error', onIrcError);
    ircClient.addListener('message', function (from, to, message) {
        var user = onlineUsersForUsername.get(from);
        if (user === undefined) {
            console.log(`[IRC to Sync] [Not Connected] OsuName: ${from}, Message: ${message}`);
            ircClient.say(from, "Your Sync isn't connected to the server.");
            return;
        }
        if (message === "!logout") {
            user.websocket.close();
            ircClient.say(from, "Logout success!");
            return;
        }
        onIrcMessage(user, message);
    });

    //websocket event
    ws.on('connection',
        function (wsocket, request) {
            let cookie = parseCookie(request.headers.cookie);
            let user = {
                websocket: wsocket,
                ircTargetUsername: cookie.transfer_target_name,
                heartChecker: null,
                lastSendTime: new Date(),
                messageCountPerMinute: config.maxMessageCountPerMinute,
                timer: setInterval(()=>user.messageCountPerMinute = config.maxMessageCountPerMinute,1 * 60 * 1000)
            };

            wsocket.on('message', (msg) => {
                let user = onlineUsers.get(wsocket)
                user.lastSendTime = new Date();
                if (msg === CONST_HEART_CHECK_FLAG) {
                    //reset heart checker
                    if (user.heartChecker !== null)
                        clearTimeout(user.heartChecker);
                    user.heartChecker = setTimeout(() => wsocket.close(), CONST_HEART_CHECK_TIMEOUT);

                    if (wsocket.readyState === wsocket.OPEN)
                        wsocket.send(CONST_HEART_CHECK_OK_FLAG);

                    return;
                }
                if(user.messageCountPerMinute === 0){
                    user.websocket.send("Send too often, please try again later.");
                    user.websocket.send("Not suggest user who are streamer with lots of viewer because it's may made osu!irc bot spam and be punished by Bancho");
                    return;
                }
                user.messageCountPerMinute--;
                onWebsocketMessage(user, msg);
            });

            wsocket.on('error', onWebsocketError);
            wsocket.on('close', () => {
                if (!onlineUsers.has(wsocket)) {
                    return;
                }
                if (user.heartChecker !== null)
                    clearTimeout(user.heartChecker);
                clearInterval(user.timer);
                onlineUsers.delete(wsocket);
                onlineUsersForUsername.delete(user.ircTargetUsername);

                ircClient.say(user.ircTargetUsername, "Your Sync has disconnected from the server.");
                console.log(`Online User Count: ${onlineUsers.size}`);
            });

            if (onlineUsersForUsername.has(user.ircTargetUsername)) {
                if (wsocket.readyState === wsocket.OPEN)
                    wsocket.send(`The TargetUsername is connected! Send "!logout" logout the user to ${config.ircBotName}`);
                wsocket.close();
                return;
            }

            onlineUsers.set(wsocket, user);
            onlineUsersForUsername.set(user.ircTargetUsername, user);

            if (config.welcomeMessage != null && config.welcomeMessage != "")
                ircClient.say(user.ircTargetUsername, config.welcomeMessage);

            if (request.headers["botredirectfrom"] !== undefined) {
                wsocket.send("Your current MikiraSora's PublicBotTransferPlugin server is about to close. Please go to https://github.com/MikiraSora/PublicBotTransferPlugin/releases to download the latest version of the plugin and extract it to the Sync root directory.")
            }

            wsocket.send(`You can send ${config.maxMessageCountPerMinute} messages per minute`);

            console.log(`Online User Count: ${onlineUsers.size}`);
        });

    function onIrcMessage(user, msg) {
        console.log(`[IRC to Sync] User: ${user.ircTargetUsername}, Message: ${msg}`);
        if (user.websocket.readyState === user.websocket.OPEN)
            user.websocket.send(msg);
    }

    function onIrcError(err) {
        console.error(`[IRC] ${JSON.stringify(err)}`);
    }

    function onWebsocketMessage(user, msg) {
        console.log(`[Sync to IRC] User: ${user.ircTargetUsername}, Message: ${msg}`);
        ircClient.say(user.ircTargetUsername, msg);
    }

    function onWebsocketError(err) {
        console.error(`[Websocket] ${err}`);
    }

    //Regular cleaning
    setInterval(function () {
        let date = new Date();
        let list = [];
        onlineUsersForUsername.forEach((v, k) => {
            if (date - v.lastSendTime > CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL) {
                list.push(v);
            }
        });

        let str = "Clear Users: ";

        for (let user of list) {
            str += `${user.ircTargetUsername}\t`;
            user.websocket.close();
        }
        if (list.length !== 0)
            console.log(str);
    }, CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL);

    //console command
    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    function printHelp() {
        console.info('onlineusers\t\t\t- list all online users');
        console.info('sendtoirc username message\t- send message to user via irc');
        console.info('sendtosync username message\t- send message to user via sync');
        console.info('help\t\t\t\t- display help');
    }

    rl.on('line', function (line) {
        let breaked = line.split(' ');
        switch (breaked[0]) {
            case "sendtoirc":
                if (breaked.length >= 3) {
                    if (onlineUsersForUsername.has(breaked[1])) {
                        ircClient.say(breaked[1], breaked[2]);
                    } else {
                        console.info("[Command] User no connented");
                    }
                } else {
                    printHelp();
                }
                break;
            case "sendtosync":
                if (breaked.length >= 3) {
                    if (onlineUsersForUsername.has(breaked[1])) {
                        let user = onlineUsersForUsername.get(breaked[1]);
                        user.websocket.send(breaked[2]);
                    } else {
                        console.info("[Command] User no connented");
                    }
                } else {
                    printHelp();
                }
                break;
            case "onlineusers":
                let str = '';
                onlineUsersForUsername.forEach((v, k) => str += `${k}\t`);
                console.info(str);
                console.info(`Count:${onlineUsersForUsername.size}`);
                break;
            case "help":
            default:
                printHelp();
        }
    });

    console.log(`Sync Bot Server Start: ws://0.0.0.0:${config.port}${config.path}`);
}

config = loadConfig();
startServer(config);
