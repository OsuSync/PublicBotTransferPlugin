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
const https = require('https');
const crypto = require('crypto');

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

    async bannedUsers() {
        const data = await this.db.all(SQL`SELECT username,banned_duration,banned_date FROM Users WHERE banned = 1`);
        return data;
    }


    async getUid(username) {
        const data = await this.db.get(SQL`SELECT uid FROM Users WHERE username = ${username}`);
        if (data !== undefined){
            return data["uid"];
        }
        
        const osuData = await this.getUidFromOsu(username);
        if(osuData.username.toLowerCase().replace(/\s/g, '_') === username.toLowerCase()){
            return osuData.uid;
        }
        return undefined;
    }

    async getUidFromOsu(username) {
        return new Promise(function (resolve) {
            https.get(`https://osu.ppy.sh/u/${username}`, (res) => {
                if (res.statusCode == 302 && res.headers.location !== undefined) {
                    const uid = res.headers.location.match(/\d+/g)[0];

                    https.get(res.headers.location, (res) => {
                        let body = '';
                        res.on('data', function (chunk) {
                            body += chunk;
                        });
                        res.on('end', function () {
                            const data = body.match(/"username":"(\s|\w|\[|\])+"/);
                            if(data != null){
                                const usernameFromOsu = data[0].split(':')[1].replace(/"/g, '');
                                resolve({ uid: Number.parseInt(uid), username: usernameFromOsu });
                            } else {
                                resolve(undefined);
                            }
                        });
                    });
                } else {
                    resolve(undefined);
                }
                res.resume();
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
        const user = this.get(key);
        if (user !== undefined) {
            user.deconstructor();

            const index = this.onlineUsersList.indexOf(user);
            this.onlineUsersList.splice(index, 1);

            const lower = user.username.toLowerCase();
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

class CommandLineInputer extends events.EventEmitter {
    constructor() {
        super();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        if (process.platform === "win32") {
            this.rl.on("SIGINT", function () {
                process.emit("SIGINT");
            });
        }

        process.on("SIGINT", function () {
            this.emit('exit');
            process.exit();
        });

        this.rl.on('line', (line) => {
            this.emit('command', line, null);
        });
    }
}

class IrcInputer extends events.EventEmitter {
    constructor() {
        super();
    }

    input(line, user) {
        const ctx = {
            user: user
        };
        this.emit('command', line, ctx);
    }
}

class CommandProcessor {
    constructor(inputer, outputer = () => { }) {
        this.inputer = inputer;
        this.outputer = outputer;
        this.map = new Map();

        this.start();
        this.register('help', () => {
            this.printHelp();
        }, 'Show help meesage');
    }

    register(command, func, helpMsg) {
        this.map.set(command, {
            func: func,
            helpMsg: helpMsg,
            arguments: this.getArguments(func)
        });
    }

    printHelp(ctx = null) {
        let data = [];
        this.map.forEach((v, k) => {
            data.push({
                command: `${k} ${v.arguments.join(' ')}`,
                description: v.helpMsg
            });
        });
        this.outputer.call(ctx, columnify(data, {
            minWidth: 40,
            columnSplitter: ' | ',
            headingTransform: function (heading) {
                return heading.toUpperCase().green;
            }
        }));
    }

    start() {
        this.inputer.on('command', (line, ctx) => {
            let breaked = line.split(' ');
            let cmd = this.map.get(breaked[0]);
            if (cmd !== undefined) {
                breaked.splice(0, 1);
                cmd.func.apply(ctx, breaked);
            } else {
                this.outputer.call(ctx, `No found '${breaked[0]}' command`.inverse);
            }
        });
    }

    getArguments(fn) {
        return /\((\s*\w[0-9A-za-z]*\s*,?\s*)*\)/.exec(fn.toString())[0].replace(/(\(|\)|\s)/g, '').replace(/,/g, ' ').split(' ');
    }
}

function patchConsole() {
    const stream = fs.createWriteStream(`${__dirname}/log.log`);
    const oldLog = console.log;
    const oldError = console.error;
    const oldDebug = console.debug;
    const oldWarn = console.warn;

    console.log = function (msg) {
        const logStr = `[${new Date().toLocaleTimeString()}] [Log] ${msg}`;
        oldLog(logStr.green);
        stream.write(`${logStr}\n`);
    }

    console.error = function (msg) {
        const logStr = `[${new Date().toLocaleTimeString()}] [Error] ${msg}`;
        oldError(logStr.red);
        stream.write(`${logStr}\n`);
    }

    console.debug = function (msg) {
        const logStr = `[${new Date().toLocaleTimeString()}] [Debug] ${msg}`;
        oldDebug(logStr);
        stream.write(`${logStr}\n`);
    }

    console.warn = function (msg) {
        const logStr = `[${new Date().toLocaleTimeString()}] [Warn] ${msg}`;
        oldWarn(logStr.yellow);
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
    if (cookie.transfer_target_name === undefined)
        return false;

    // if (cookie.mac === undefined || cookie.hwid === undefined)
    //     return false;

    if (cookie.transfer_target_name.indexOf("#") != -1)
        return false;

    if (cookie.transfer_target_name.toLowerCase().replace(/\s/g, '_') === config.ircBotName.toLowerCase().replace(/\s/g, '_'))
        return false;

    return true;
}

async function userLoginVerify(user, usersManager) {
    let result = {
        result: true,
        code: 0,
        reason: undefined
    }

    if (user.uid === undefined) {//code 1
        result.result = false;
        result.code = 1;
        result.reason = "No found uid from osu.ppy.sh";
    }

    //check was banned
    if (await usersManager.isBanned(user)) {
        const bannedDuration = await usersManager.bannedDuration(user);
        const bannedDate = await usersManager.bannedDate(user);
        const currentDate = Date.now();
        const time = new Date(bannedDate + bannedDuration - currentDate);
        if (currentDate > (bannedDate + bannedDuration)) {
            await usersManager.unban(user);//time is over, unban.
        } else {//code 2
            result.code = 2;
            result.reason = `Your are restricted! ${time.getMinutes()} minutes ${time.getSeconds()} seconds without restrictions.`;
            result.result = false;
        }
    }

    return result;
}

async function startServer(ircServer, config) {
    const CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
    const CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
    const CONST_SYNC_NOTICE_HEADER = "\x01\x03\x01";

    const CONST_HEART_CHECK_TIMEOUT = 30 * 1000;//30s
    const CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL = 60 * 1000//60s
    const CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL = 30 * 60 * 1000;//30m

    const CONST_BAN_LOGIN_DATE_INTERVAL = 10 * 1000;//10s
    const CONST_BAN_LOGIN_DURATION = 10 * 60 * 1000;//10m;
    const CONST_MAX_BAN_DURATION = Number.MAX_SAFE_INTEGER / 2;

    const onlineUsers = new OnlineUsersManager();
    const usersManager = new UsersManager();
    await usersManager.openDatabase();

    const ircClient = new irc.Client(ircServer, config.ircBotName, {
        port: 6667,
        autoConnect: true,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    const commandLineInputer = new CommandLineInputer();
    const commandProcessor = new CommandProcessor(commandLineInputer, console.info);
    const ircInputer = new IrcInputer();
    const ircCommandProcessor = new CommandProcessor(ircInputer);

    const ws = new WebSocketServer({
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
        if (from.toLowerCase() === config.ircBotName.toLowerCase()) {
            console.log(`[IRC] Received message from self, Message: ${message}`);
            return;
        }

        if (user === undefined) {
            console.log(`[IRC to Sync] [Not Connected] OsuName: ${from}, Message: ${message}`);
            //ircClient.say(from, "Your Sync isn't connected to the server.");
            return;
        }

        if (message.startsWith('!')) {
            ircInputer.input(message.substring(1), user);
            return;
        }

        onIrcMessage(user, message);
    });

    //hook say
    ircClient.oldSay = ircClient.say;
    ircClient.say = function (nick, msg) {
        if (nick.toLowerCase() !== config.ircBotName.toLowerCase())
            ircClient.oldSay(nick, msg);
    };

    WebSocket.prototype.sendNotice = function (msg) {
        this.send(`${CONST_SYNC_NOTICE_HEADER}${msg}`);
    }

    //websocket event
    ws.on('connection',
        async function (wsocket, request) {
            let cookie = parseCookie(request.headers.cookie);
            const username = cookie.transfer_target_name.replace(/\s/g, '_');
            const uid = await usersManager.getUid(username);
            const mac = (cookie.mac !== undefined) ? crypto.createHash('md5').update(cookie.mac).digest('hex') : undefined;

            let user = {
                uid: uid,
                websocket: wsocket,
                username: username,
                mac: mac,
                hwid: cookie.hwid,
                heartChecker: null,
                lastSendTime: Date.now(),
                //message limit
                messageCountPerMinute: config.maxMessageCountPerMinute,
                //reset message limit
                messageCountTimer: setInterval(() => user.messageCountPerMinute = config.maxMessageCountPerMinute, 1 * 60 * 1000),
                sendToSync: function (msg, type = "message") {
                    if (this.websocket === undefined) {
                        console.error(`${this.username} no websocket!`)
                        return;
                    }

                    if (this.websocket.readyState !== this.websocket.OPEN) {
                        console.error(`${this.username}'s websocket isn't open. (state code:${this.websocket.readyState})`)
                        return;
                    }

                    const map = {
                        message: (msg) => this.websocket.send(msg),
                        notice: (msg) => this.websocket.sendNotice(msg)
                    };
                    const send = map[type];

                    if (send !== undefined) {
                        send(msg);
                    } else {
                        console.warn(`User: ${this.username}, Unknown message type. type should be "message" or "notice"`);
                    }
                },
                sendToIrc: function (msg) {
                    ircClient.say(this.username, msg);
                },
                disconnect: function (msg, code = 1000) {
                    this.websocket.close(code, msg);
                    onlineUsers.remove(this.websocket);
                },
                deconstructor: function () {
                    if (this.heartChecker !== null)
                        clearTimeout(this.heartChecker);
                    clearInterval(this.messageCountTimer);
                }
            };

            //received websocket message
            wsocket.on('message', (msg) => {
                let user = onlineUsers.get(wsocket)
                if (user === undefined)return;

                user.lastSendTime = Date.now();

                //message is heart check
                if (msg === CONST_HEART_CHECK_FLAG) {
                    //reset heart checker
                    if (user.heartChecker !== null)
                        clearTimeout(user.heartChecker);
                    user.heartChecker = setTimeout(() => user.disconnect(), CONST_HEART_CHECK_TIMEOUT);

                    if (wsocket.readyState === wsocket.OPEN)
                        wsocket.send(CONST_HEART_CHECK_OK_FLAG);

                    return;
                }

                if (user.messageCountPerMinute === 0) {
                    user.sendToSync("Send too often, please try again later.");
                    user.sendToSync("Not suggest user who are streamer with lots of viewer because it's may made osu!irc bot spam and be punished by Bancho");
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
                onlineUsers.remove(wsocket);

                user.sendToIrc("Your Sync has disconnected from the server.");
                console.log(`Online User Count: ${onlineUsers.size}`);
            });

            const verifyResult = await userLoginVerify(user, usersManager);
            if (!verifyResult.result) {
                user.disconnect(verifyResult.reason, 1008);
                return;
            }

            //Check that the user is online.
            if (onlineUsers.online(user.username)) {
                user.disconnect(`The TargetUsername is connected! Send "!logout" logout the user to ${config.ircBotName}`);
                return;
            } else {
                //add user to onlineUsers
                onlineUsers.add(user);
            }

            //add/update user to database
            if (!await usersManager.exist(user)) {
                await usersManager.add(user);
            } else {
                //If the login interval is too short, ban the user.
                let lastLoginDate = await usersManager.lastLoginDate(user);
                let currentDate = Date.now();
                const time = new Date(CONST_BAN_LOGIN_DURATION);

                if (currentDate - lastLoginDate < CONST_BAN_LOGIN_DATE_INTERVAL) {
                    usersManager.ban(user, CONST_BAN_LOGIN_DURATION);
                    user.sendToIrc(`Your are restricted! ${time.getMinutes()} minutes ${time.getSeconds()} seconds without restrictions.`)
                    user.disconnect(`Your are restricted! ${time.getMinutes()} minutes ${time.getSeconds()} seconds without restrictions.`, 1008);
                    return;
                }
                await usersManager.update(user);
            }

            //send welcomeMessage
            if (config.welcomeMessage != null && config.welcomeMessage != "")
                user.sendToIrc(config.welcomeMessage);

            if (request.headers["botredirectfrom"] !== undefined) {
                user.sendToSync("Your current MikiraSora's PublicBotTransferPlugin server is about to close. Please go to https://github.com/MikiraSora/PublicBotTransferPlugin/releases to download the latest version of the plugin and extract it to the Sync root directory.", 'notice');
            }
            user.sendToSync(`You can send ${config.maxMessageCountPerMinute} messages per minute`, 'notice');

            console.log(`Online User Count: ${onlineUsers.size}`);
        });

    function onIrcMessage(user, msg) {
        console.log(`[IRC to Sync] User: ${user.username}, Message: ${msg}`);
        user.sendToSync(msg);
    }

    function onIrcError(err) {
        if (err.command === 'err_nosuchnick') {
            console.warn(`[IRC] ${JSON.stringify(err)}`);
        } else {
            console.error(`[IRC] ${JSON.stringify(err)}`);
        }
    }

    function onWebsocketMessage(user, msg) {
        console.log(`[Sync to IRC] User: ${user.username}, Message: ${msg}`);
        user.sendToIrc(msg);
    }

    function onWebsocketError(err) {
        console.error(`[Websocket] ${err}`);
    }

    //Regular cleaning
    setInterval(function () {
        let date = Date.now();
        let list = Enumerable.from(onlineUsers.list).where(user => (date - user.lastSendTime) > CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL);
        const time = new Date(CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL);

        list.forEach((user, i) => {
            user.disconnect(`You didn't send any messages within ${time.getMinutes()} minutes ${time.getSeconds()} seconds, and the server forced you to go offline.`);
        })
        if (list.count() !== 0) {
            console.info('----------Clear Users----------');
            console.info(list.select(user => user.username).toJoinedString('\t'));
            console.info('-------------------------------');
            console.info(`Count: ${list.count()}`);
        }
    }, CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL);

    commandProcessor.register('sendtoirc', function (target, message) {
        const user = onlineUsers.get(target);
        if (user !== undefined) {
            user.sendToIrc(message);
        } else {
            console.info("[Command] User no connented".inverse);
        }
    }, 'Send message to user via irc');

    commandProcessor.register('sendtosync', function (target, message, type) {
        type = type || "notice";

        if (onlineUsers.online(target)) {
            let user = onlineUsers.get(target);
            user.sendToSync(message, type);
        } else {
            console.info("[Command] User no connented".inverse);
        }
    }, 'Send message to user via sync');

    commandProcessor.register('onlineusers', function () {
        let str = Enumerable.from(onlineUsers.list).select(user => user.username).toJoinedString('\t');
        console.info('---------Online Users---------');
        console.info(str);
        console.info('------------------------------');
        console.info(`Count: ${onlineUsers.size}`);
    }, 'Show online users');

    commandProcessor.register('kick', function (username) {
        if (onlineUsers.online(username)) {
            const user = onlineUsers.get(username);
            user.disconnect('You are forced to go offline by the administrator.');
        } else {
            console.info(`${username} don't online.`);
        }
    }, 'Disconnect a user.');

    commandProcessor.register('allusers', async function () {
        let list = await usersManager.allUsers();
        let str = Enumerable.from(list).select(user => user.username).toJoinedString('\t');
        console.info('---------All Users---------');
        console.info(str);
        console.info('---------------------------')
        console.info(`Count: ${list.length}`);
    }, 'Show all users');

    commandProcessor.register('bannedusers', async function () {
        let list = await usersManager.bannedUsers();
        let str = Enumerable.from(list).
            where(user => user.banned_date + user.banned_duration > Date.now())
            .select(user => {
            const time = new Date(user.banned_date + user.banned_duration - Date.now());
            return {
                username: user.username,
                unbanTime: `${time.getMinutes()} Min ${time.getSeconds()} Sec`
            };
        }).toArray();
        console.info('--------Banned Users--------');
        console.info(columnify(str));
        console.info('----------------------------')
        console.info(`Count: ${str.length}`);
    }, 'Show all banned users');

    commandProcessor.register('ban', async function (username, minute = 60) {
        let user = onlineUsers.get(username) ||
            {
                uid: await usersManager.getUid(username),
                username: username
            };

        if (!await usersManager.isBanned(user)) {
            let duration = (minute === "forever") ? CONST_MAX_BAN_DURATION : minute * 60 * 1000;

            await usersManager.ban(user, duration);
            if (user.sendToIrc !== undefined) {
                user.sendToIrc('You are banned!');
                user.disconnect('You are banned!', 1008);
            }
        } else {
            console.info(`${user.username} was banned!`);
        }
    }, 'Ban a user');

    commandProcessor.register('unban', async function (username) {
        const uid = await usersManager.getUid(username);
        const user = { uid: uid };
        if (await usersManager.isBanned(user)) {
            await usersManager.unban(user);
        } else {
            console.info(`${username} wasn't banned!`);
        }
    }, 'Unban a user');

    //ctrl + c
    commandLineInputer.on('exit', function () {
        onlineUsers.forEach(user => {
            user.disconnect('The server is down.');
        });
    })

    //irc command
    ircCommandProcessor.register('logout', function () {
        this.user.disconnect();
        this.user.sendToIrc("Logout success!");
    }, "Disconnect the current user")

    console.log(`Sync Bot Server Start: ws://0.0.0.0:${config.port}${config.path}`);
}

patchConsole();
config = loadConfig();
startServer('irc.ppy.sh', config);