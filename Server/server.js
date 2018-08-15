let WebSocketServer = require('ws').Server;
let irc = require('irc');
let fs = require('fs')
let readline = require('readline');

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
    const CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
    const CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
    const CONST_HEART_CHECK_TIMEOUT = 30 * 1000;//30s

    let ircClient = new irc.Client('irc.ppy.sh', config.ircBotName, {
        port: 6667,
        autoConnect: true,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    let ws = new WebSocketServer({
        port: config.port,
        noServer: true,
        verifyClient: socketVerify,
        path: config.path
    });

    let onlineUsers = new Map();
    let onlineUsersForUsername = new Map();

    //irc event
    ircClient.addListener('registered', (msg) => console.log(`[IRC]Connected! MSG:${JSON.stringify(msg)}`));
    ircClient.addListener('error', onIrcError);
    ircClient.addListener('message', function (from, to, message) {
        var user = onlineUsersForUsername.get(from);
        if (user === undefined) {
            console.debug(`[IRC to Sync][Not Connected]OsuName: ${from}, Message: ${message}`);
            ircClient.say(from,"Your Sync isn't connected to the server.");
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
                heartChecker:setTimeout(()=>wsocket.close(),CONST_HEART_CHECK_TIMEOUT)
            };

            wsocket.on('message', (msg) => 
            {
                let user = onlineUsers.get(wsocket)
                if(msg == CONST_HEART_CHECK_FLAG){
                    //reset heart checker
                    clearTimeout(user.heartChecker);
                    user.heartChecker = setTimeout(()=>wsocket.close(),CONST_HEART_CHECK_TIMEOUT);

                    if(wsocket.readyState === wsocket.OPEN)
                        wsocket.send(CONST_HEART_CHECK_OK_FLAG);

                    return;
                }
                onWebsocketMessage(user, msg);
            });

            wsocket.on('error', onWebsocketError);
            wsocket.on('close', () => {
                if (!onlineUsers.has(wsocket)) {
                    return;
                }

                clearTimeout(user.heartChecker);
                onlineUsers.delete(wsocket);
                onlineUsersForUsername.delete(user.ircTargetUsername);
                console.log(`Online User Count: ${onlineUsers.size}`);
            });

            if (onlineUsersForUsername.has(user.ircTargetUsername)) {
                if(wsocket.readyState === wsocket.OPEN)
                    wsocket.send('The TargetUsername is connected!');
                wsocket.close();
                return;
            }

            onlineUsers.set(wsocket, user);
            onlineUsersForUsername.set(user.ircTargetUsername, user);

            if (config.welcomeMessage != null && config.welcomeMessage != "")
                ircClient.say(user.ircTargetUsername, config.welcomeMessage);

            console.log(`Online User Count: ${onlineUsers.size}`);
        });

    function onIrcMessage(user, msg) {
        console.debug(`[IRC to Sync]User: ${user.ircTargetUsername}, Message: ${msg}`);
        if(user.websocket.readyState === user.websocket.OPEN)
            user.websocket.send(msg);
    }

    function onIrcError(err) {
        console.error(`[IRC][ERROR]${JSON.stringify(err)}`);
    }

    function onWebsocketMessage(user, msg) {
        console.debug(`[Sync to IRC]User: ${user.ircTargetUsername}, Message: ${msg}`);
        ircClient.say(user.ircTargetUsername, msg);
    }

    function onWebsocketError(err) {
        console.error(`[Websocket][ERROR]${err}`);
    }

    console.log(`Sync Bot Server Start: ws://0.0.0.0:${config.port}${config.path}`);

    //console command
    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    function printHelp(){
        console.log('onlineusers    - list all online users');
        console.log('sendtoirc username message    - send message to user via irc');
        console.log('sendtosync username message    - send message to user via sync');
        console.log('help    - display help');
    }

    rl.on('line', function (line) {
        let breaked = line.split(' ');
        switch (breaked[0]) {
            case "sendtoirc":
                if (breaked.length >= 3) {
                    if (onlineUsersForUsername.has(breaked[1])) {
                        ircClient.say(breaked[1], breaked[2]);
                    } else {
                        console.log("[Command]User no connented");
                    }
                }else{
                    printHelp();
                }
                break;
            case "sendtosync":
                if (breaked.length >= 3) {
                    if (onlineUsersForUsername.has(breaked[1])) {
                        let user = onlineUsersForUsername.get(breaked[1]);
                        user.websocket.send(breaked[2]);
                    } else {
                        console.log("[Command]User no connented");
                    }
                }else{
                    printHelp();
                }
                break;
            case "onlineusers":
                let str = '';
                onlineUsersForUsername.forEach((v,k)=>str+=`${k}\t`);
                console.log(str);
                console.log(`Count:${onlineUsersForUsername.size}`);
                break;
            case "help":
            default:
                printHelp();
        }
    });
}

config = loadConfig();
startServer(config);