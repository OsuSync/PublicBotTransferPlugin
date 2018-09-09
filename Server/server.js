const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const irc = require('irc');
const fs = require('fs')
const readline = require('readline');
const events = require('events');
const sqlite = require('sqlite');
const SQL = require('sql-template-strings');
const colors = require("colors");
const Enumerable = require('linq');
const columnify = require('columnify');
const https = require('https')

class UsersManager {
    constructor() {
        this.db = null;
    }

    async openDatabase() {
        if (!fs.existsSync('./users.db')) {
            this.db = await sqlite.open('./users.db');
            await this.createAndInitializeDatabase();
        } else {
            this.db = await sqlite.open('./users.db');
        }
    }

    async createAndInitializeDatabase() {
        await this.db.run(SQL`CREATE TABLE Users 
                        (uid INTEGER PRIMARY KEY,
                         username TEXT COLLATE NOCASE,
                         hwid TEXT,
                         mac TEXT,
                         banned INTEGER,
                         banned_duration INTEGER,
                         banned_date INTEGER,
                         first_login_date INTEGER,
                         last_login_date INTEGER)`);
    }

    async add({ uid, username, mac, hwid }) {
        await this.db.run(SQL`INSERT INTO Users VALUES(
            ${uid},
            ${username},
            ${hwid},
            ${mac},
            0,
            0,
            0,
            ${Date.now()},
            ${Date.now()})`);
    }

    async ban({ uid, mac = "", hwid = "" }, bannedDuration) {
        return await this.db.run(SQL`UPDATE Users SET
            banned = 1,
            banned_duration = ${Math.floor(bannedDuration)},
            banned_date = ${Date.now()}
        WHERE (uid = ${uid} OR mac = ${mac} OR hwid = ${hwid})`);
    }

    async unban({ uid }) {
        return await this.db.run(SQL`UPDATE Users SET
            banned = 0,
            banned_duration = 0
        WHERE uid = ${uid}`);
    }

    async exist({ uid, mac, hwid }) {
        const data = await this.db.get(SQL`SELECT COUNT(*) FROM Users 
            WHERE uid = ${uid}
                OR mac = ${mac} 
                OR hwid = ${hwid}`);
        return data["COUNT(*)"] !== 0;
    }

    async isBanned({ uid, mac = "", hwid = "" }) {
        const data = await this.db.get(SQL`SELECT COUNT(*) FROM Users 
            WHERE (uid = ${uid}
                OR mac = ${mac} 
                OR hwid = ${hwid})
                AND banned = 1`);
        return data["COUNT(*)"] !== 0;
    }

    async update({ uid, username, mac, hwid }) {
        return await this.db.run(SQL`UPDATE Users SET
                                        username = ${username},
                                        mac = ${mac},
                                        hwid = ${hwid},
                                        last_login_date = ${Date.now()}
                                    WHERE uid = ${uid} OR mac = ${mac} OR hwid = ${hwid}`);
    }

    async lastLoginDate({ uid, mac, hwid }) {
        const data = await this.db.get(SQL`SELECT last_login_date FROM Users 
            WHERE uid = ${uid} 
                OR mac = ${mac} 
                OR hwid = ${hwid}`);
        return data["last_login_date"];
    }

    async bannedDuration({ uid, mac, hwid }) {
        const data = await this.db.get(SQL`SELECT banned_duration FROM Users 
            WHERE uid = ${uid} 
                OR mac = ${mac} 
                OR hwid = ${hwid}`);
        return data["banned_duration"];
    }

    async bannedDate({ uid, mac, hwid }) {
        const data = await this.db.get(SQL`SELECT banned_date FROM Users 
            WHERE uid = ${uid} 
                OR mac = ${mac} 
                OR hwid = ${hwid}`);
        return data["banned_date"];
    }

    async allUsers() {
        const data = await this.db.all(SQL`SELECT username FROM Users`);
        return data;
    }

    async getUid(username){
        const data = await this.db.get(SQL`SELECT uid FROM Users WHERE username = ${username}`);
        if(data === undefined)
            return undefined;
        return data["uid"];
    }

    async getUidFromOsu(username) {
        return new Promise(function (resolve) {
            https.get(`https://osu.ppy.sh/u/${username}`, (res) => {
                if (res.statusCode == 302 && res.headers.location !== undefined) {
                    const uid = res.headers.location.match(/\d+/g)[0];
                    resolve(Number.parseInt(uid));
                    return;
                }
                resolve(undefined);
            })
        });
    }
}

class OnlineUsersManager {
    constructor() {
        this.mapOnlineUsers = new Map();
        this.mapOnlineUsersForUsername = new Map();

        this.onlineUsersList = [];
    }

    add(user) {
        if (!this.online(user.username)) {
            let lower = user.username.toLowerCase();
            this.mapOnlineUsersForUsername.set(lower, user);
            this.mapOnlineUsers.set(user.websocket, user);
            this.onlineUsersList.push(user);
        }
    }

    get(key) {
        let user = null;
        if (typeof (key) === "string") {
            user = this.mapOnlineUsersForUsername.get(key.toLowerCase());
        } else {
            user = this.mapOnlineUsers.get(key);
        }
        return user;
    }

    remove(key) {
        let user = this.get(key);
        if (user !== undefined) {
            let index = this.onlineUsersList.indexOf(user);
            this.onlineUsersList.splice(index, 1);

            let lower = user.username.toLowerCase();
            this.mapOnlineUsersForUsername.delete(lower);
            this.mapOnlineUsers.delete(user.websocket);
        }
    }

    online(key) {
        let user = this.get(key);
        if (user !== undefined)
            return true;
        return false;
    }

    get list() {
        return this.onlineUsersList;
    }

    get size() {
        return this.onlineUsersList.length;
    }
}

class CommandProcessor extends events.EventEmitter {
    constructor() {
        super();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.map = new Map();

        if (process.platform === "win32") {
            this.rl.on("SIGINT", function () {
                process.emit("SIGINT");
            });
        }

        process.on("SIGINT", function () {
            this.emit('exit');
            process.exit();
        })

        this.start();
        this.register('help', () => {
            this.printHelp();
        }, 'display help meesage');
    }

    register(command, func, helpMsg) {
        this.map.set(command, {
            func: func,
            helpMsg: helpMsg,
            arguments: this.getArguments(func)
        });
    }

    printHelp() {
        let data = [];
        this.map.forEach((v, k) => {
            data.push({
                command: `${k} ${v.arguments.join(' ')}`,
                description: v.helpMsg
            });
        });
        console.info(columnify(data, {
            minWidth: 40,
            columnSplitter: ' | ',
            headingTransform: function (heading) {
                return heading.toUpperCase().green;
            }
        }));
    }

    start() {
        this.rl.on('line', (line) => {
            let breaked = line.split(' ');
            let cmd = this.map.get(breaked[0]);
            if (cmd !== undefined) {
                breaked.splice(0, 1);
                cmd.func(...breaked);
            } else {
                console.info(`No found '${breaked[0]}' command`.inverse);
                this.printHelp();
            }
        });
    }

    getArguments(fn) {
        return /\((\s*\w[0-9A-za-z]*\s*,?\s*)*\)/.exec(fn.toString())[0].replace(/(\(|\)|\s)/g, '').replace(/,/g, ' ').split(' ');
    }
}

function patchConsole() {
    let stream = fs.createWriteStream(`${__dirname}/log.log`);
    let oldLog = console.log;
    let oldError = console.error;
    let oldDebug = console.debug;

    console.log = function (msg) {
        let logStr = `[${new Date().toLocaleTimeString()}] [Log] ${msg}`;
        oldLog(logStr.green);
        stream.write(`${logStr}\n`);
    }

    console.error = function (msg) {
        let logStr = `[${new Date().toLocaleTimeString()}] [Error] ${msg}`;
        oldError(logStr.red);
        stream.write(`${logStr}\n`);
    }

    console.debug = function (msg) {
        let logStr = `[${new Date().toLocaleTimeString()}] [Debug] ${msg}`;
        oldDebug(logStr);
        stream.write(`${logStr}\n`);
    }
}

function loadConfig() {
    let data = fs.readFileSync('./config.json');
    let config = JSON.parse(data.toString());
    return config;
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

function socketVerify(info, config) {
    let cookie = parseCookie(info.req.headers.cookie);
    if (cookie.transfer_target_name === undefined ||
        cookie.mac === undefined ||
        cookie.hwid === undefined)
        return false;

    if (cookie.transfer_target_name.indexOf("#") != -1)
        return false;

    if (cookie.transfer_target_name.toLowerCase() === config.ircBotName.toLowerCase())
        return false;

    return true;
}

async function startServer(config) {
    const CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
    const CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
    const CONST_SYNC_NOTICE_HEADER = "\x01\x03\x01";

    const CONST_HEART_CHECK_TIMEOUT = 30 * 1000;//30s
    const CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL = 60 * 1000//60s
    const CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL = 30 * 60 * 1000;//30m

    const CONST_BAN_LOGIN_DATE_INTERVAL = 10 * 1000;//10s
    const CONST_BAN_LOGIN_DURATION = 30 * 1000 * 1000;//30m;
    const CONST_MAX_BAN_DURATION = Number.MAX_SAFE_INTEGER / 2;

    const commandProcessor = new CommandProcessor();
    const onlineUsers = new OnlineUsersManager();
    const usersManager = new UsersManager();
    await usersManager.openDatabase();

    let ircClient = new irc.Client('irc.ppy.sh', config.ircBotName, {
        port: 6667,
        autoConnect: true,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    let ws = new WebSocketServer({
        port: config.port,
        noServer: true,
        verifyClient: (info) => socketVerify(info, config, usersManager),
        path: config.path
    });

    //irc event
    ircClient.addListener('registered', (msg) => console.log(`[IRC] Connected! MSG:${JSON.stringify(msg)}`));
    ircClient.addListener('error', onIrcError);
    //received irc message
    ircClient.addListener('message', function (from, to, message) {
        let user = onlineUsers.get(from);
        if (from === config.ircBotName) {
            console.log(`[IRC] Received message from self, Message: ${message}`);
            return;
        }

        if (user === undefined) {
            console.log(`[IRC to Sync] [Not Connected] OsuName: ${from}, Message: ${message}`);
            ircClient.say(from, "Your Sync isn't connected to the server.");
            return;
        }
        //force disconnect
        if (message === "!logout") {
            user.websocket.close();
            ircClient.say(from, "Logout success!");
            return;
        }
        onIrcMessage(user, message);
    });

    //hook say
    ircClient.oldSay = ircClient.say;
    ircClient.say = function (nick, msg) {
        if (nick !== config.ircBotName)
            ircClient.oldSay(nick, msg);
    };

    WebSocket.prototype.sendNotice = function (msg) {
        this.send(`${CONST_SYNC_NOTICE_HEADER}${msg}`);
    }

    //websocket event
    ws.on('connection',
        async function (wsocket, request) {
            let cookie = parseCookie(request.headers.cookie);
            const username = cookie.transfer_target_name;
            const uid = (await usersManager.getUid(username)) || (await usersManager.getUidFromOsu(username));
            if (uid === -1) {
                wsocket.close();
                return;
            }

            let user = {
                uid: uid,
                websocket: wsocket,
                username: username,
                mac: cookie.mac,
                hwid: cookie.hwid,
                heartChecker: null,
                lastSendTime: new Date(),
                //message limit
                messageCountPerMinute: config.maxMessageCountPerMinute,
                //reset message limit
                timer: setInterval(() => user.messageCountPerMinute = config.maxMessageCountPerMinute, 1 * 60 * 1000)
            };



            //check was banned
            if (await usersManager.isBanned(user)) {
                let bannedDuration = await usersManager.bannedDuration(user);
                let bannedDate = await usersManager.bannedDate(user);
                let currentDate = Date.now();
                if (currentDate > bannedDate + bannedDuration) {
                    usersManager.unban(user);
                } else {
                    user.websocket.close();
                    return;
                }
            }

            //add/update user to database
            if (!await usersManager.exist(user)) {
                await usersManager.add(user);
            } else {
                //If the login interval is too short, ban the user.
                let lastLoginDate = await usersManager.lastLoginDate(user);
                let currentDate = Date.now();
                if (currentDate - lastLoginDate < CONST_BAN_LOGIN_DATE_INTERVAL) {
                    usersManager.ban(user, CONST_BAN_LOGIN_DURATION);
                    ircClient.say(user.username, "Your are restricted!")
                    user.websocket.close();
                    return;
                }
                await usersManager.update(user);
            }

            //Check that the user is online.
            if (onlineUsers.online(user.username)) {
                if (wsocket.readyState === wsocket.OPEN)
                    wsocket.send(`The TargetUsername is connected! Send "!logout" logout the user to ${config.ircBotName}`);
                wsocket.close();
                return;
            } else {
                //add user to onlineUsers
                onlineUsers.add(user);
            }

            //received websocket message
            wsocket.on('message', (msg) => {
                let user = onlineUsers.get(wsocket)
                user.lastSendTime = new Date();

                //message is heart check
                if (msg === CONST_HEART_CHECK_FLAG) {
                    //reset heart checker
                    if (user.heartChecker !== null)
                        clearTimeout(user.heartChecker);
                    user.heartChecker = setTimeout(() => wsocket.close(), CONST_HEART_CHECK_TIMEOUT);

                    if (wsocket.readyState === wsocket.OPEN)
                        wsocket.send(CONST_HEART_CHECK_OK_FLAG);

                    return;
                }

                if (user.messageCountPerMinute === 0) {
                    user.websocket.send("Send too often, please try again later.");
                    user.websocket.send("Not suggest user who are streamer with lots of viewer because it's may made osu!irc bot spam and be punished by Bancho");
                    return;
                }
                user.messageCountPerMinute--;

                //process normal message
                onWebsocketMessage(user, msg);
            });

            wsocket.on('error', onWebsocketError);
            wsocket.on('close', () => {
                if (!onlineUsers.online(wsocket)) {
                    return;
                }
                if (user.heartChecker !== null)
                    clearTimeout(user.heartChecker);
                clearInterval(user.timer);
                onlineUsers.remove(wsocket);

                ircClient.say(user.username, "Your Sync has disconnected from the server.");
                console.log(`Online User Count: ${onlineUsers.size}`);
            });

            //send welcomeMessage
            if (config.welcomeMessage != null && config.welcomeMessage != "")
                ircClient.say(user.username, config.welcomeMessage);

            if (request.headers["botredirectfrom"] !== undefined) {
                wsocket.sendNotice("Your current MikiraSora's PublicBotTransferPlugin server is about to close. Please go to https://github.com/MikiraSora/PublicBotTransferPlugin/releases to download the latest version of the plugin and extract it to the Sync root directory.")
            }
            wsocket.sendNotice(`You can send ${config.maxMessageCountPerMinute} messages per minute`);

            console.log(`Online User Count: ${onlineUsers.size}`);
        });

    function onIrcMessage(user, msg) {
        console.log(`[IRC to Sync] User: ${user.username}, Message: ${msg}`);
        if (user.websocket.readyState === user.websocket.OPEN)
            user.websocket.send(msg);
    }

    function onIrcError(err) {
        console.error(`[IRC] ${JSON.stringify(err)}`);
    }

    function onWebsocketMessage(user, msg) {
        console.log(`[Sync to IRC] User: ${user.username}, Message: ${msg}`);
        ircClient.say(user.username, msg);
    }

    function onWebsocketError(err) {
        console.error(`[Websocket] ${err}`);
    }

    //Regular cleaning
    setInterval(function () {
        let date = new Date();
        let list = Enumerable.from(onlineUsers.list).where(user => date - user.lastSendTime > CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL);
        list.forEach((user, i) => {
            user.websocket.close();
        })
        if (list.count() !== 0) {
            console.info('----------Clear Users----------');
            console.log(`: ${list.select(u => user.username).toJoinedString('\t')}`);
            console.info('-------------------------------');
            console.info(`Count: ${list.count()}`);
        }
    }, CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL);

    commandProcessor.register('sendtoirc', function (target, message) {
        if (onlineUsers.online(target)) {
            ircClient.say(target, message);
        } else {
            console.info("[Command] User no connented".inverse);
        }
    }, 'send message to user via irc');

    commandProcessor.register('sendtosync', function (target, message, type) {
        type = type || "notice";

        if (onlineUsers.online(target)) {
            let user = onlineUsers.get(target);
            if (type === "notice") {
                user.websocket.sendNotice(message);
            } else if (type === "message") {
                user.websocket.send(message);
            } else {
                console.info('[Command] Unknown message type. type should be "message" or "notice".')
            }
        } else {
            console.info("[Command] User no connented".inverse);
        }
    }, 'send message to user via sync');

    commandProcessor.register('onlineusers', function () {
        let str = Enumerable.from(onlineUsers.list).select(u => u.username).toJoinedString('\t');
        console.info('---------Online Users---------');
        console.info(str);
        console.info('------------------------------');
        console.info(`Count: ${onlineUsers.size}`);
    }, 'send message to user via sync');

    commandProcessor.register('allusers', async function () {
        let list = await usersManager.allUsers();
        let str = Enumerable.from(list).select(u => u.username).toJoinedString('\t');
        console.info('---------All Users---------');
        console.info(str);
        console.info('---------------------------')
        console.info(`Count: ${list.length}`);
    }, 'displayer all users');

    commandProcessor.register('ban', async function (username, minute = 60) {
        let user = onlineUsers.get(username) || { username: username };

        if (!await usersManager.isBanned(user)) {
            let duration = (minute === "forever") ? CONST_MAX_BAN_DURATION : minute * 1000 * 1000;

            await usersManager.ban(user, duration);
            ircClient.say(user.username, 'You are banned!');
            if (user.websocket !== undefined) {
                user.websocket.send('You are banned!');
                user.websocket.close();
            }
        } else {
            console.info(`${user.username} was banned!`);
        }
    }, 'ban a user');

    commandProcessor.register('unban', async function (username) {
        const uid = await usersManager.getUid(username);
        const user = { uid: uid };
        if (await usersManager.isBanned(user)) {
            await usersManager.unban(user);
        } else {
            console.info(`${username} wasn't banned!`);
        }
    }, 'unbban a user');

    commandProcessor.on('exit', function () {
        onlineUsers.forEach(user => {
            user.websocket.send("The server is down.");
            user.websocket.close();
        });
    })

    console.log(`Sync Bot Server Start: ws://0.0.0.0:${config.port}${config.path}`);
}

patchConsole();
config = loadConfig();
startServer(config);