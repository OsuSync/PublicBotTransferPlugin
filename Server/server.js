let WebSocketServer = require('ws').Server;
let irc = require('irc');
let fs = require('fs')
let readline = require('readline');
var events = require('events');
let sqlite = require('sqlite');
let SQL = require('sql-template-strings');
var colors = require("colors")

class UsersManager{
    constructor(){
        this.db = null;
        this.maxId = 0;
    }

    async openDatabase(){
        if(!fs.existsSync('./users.db')){
            this.db = await sqlite.open('./users.db');
            await this.createAndInitializeDatabase();
        }else{
            this.db = await sqlite.open('./users.db');
        }

        this.maxId = (await this.db.get(SQL`SELECT MAX(id) FROM Users`))["MAX(id)"] || 0;
    }

    async createAndInitializeDatabase(){
        await this.db.run(SQL`CREATE TABLE Users 
                        (id INTEGER RIMARY KEY,
                         username_lower TEXT,
                         username TEXT,
                         hwid TEXT,
                         mac TEXT,
                         banned INTEGER)`);
    }

    async add({username,mac,hwid}){
        this.maxId++;
        await this.db.run(SQL`INSERT INTO Users VALUES(${this.maxId},${username.toLowerCase()},${username},${hwid},${mac},0)`);
    }

    async ban({username,mac="",hwid=""}){
        return await this.db.run(SQL`UPDATE Users SET
            banned = 1
        WHERE (username_lower = ${username.toLowerCase()} OR mac = ${mac} OR hwid = ${hwid})`);
    }

    async unban(username){
        return await this.db.run(SQL`UPDATE Users SET
            banned = 0
        WHERE username_lower = ${username.toLowerCase()}`);
    }

    async exist({username,mac,hwid}){
        let data = await this.db.get(SQL`SELECT COUNT(*) FROM Users 
            WHERE username_lower = ${username.toLowerCase()} 
                OR mac = ${mac} 
                OR hwid = ${hwid}`);
        return data["COUNT(*)"] !== 0;
    }

    async isBanned({username,mac = "",hwid = ""}){
        let data = await this.db.get(SQL`SELECT COUNT(*) FROM Users 
            WHERE (username_lower = ${username.toLowerCase()} 
                OR mac = ${mac} 
                OR hwid = ${hwid})
                AND banned = 1`);
        return data["COUNT(*)"] !== 0;
    }

    async update({username,mac,hwid}){
        return await this.db.run(SQL`UPDATE Users SET
                                        username_lower = ${username.toLowerCase()},
                                        username = ${username},
                                        mac = ${mac},
                                        hwid = ${hwid})
                                    WHERE username = ${username.toLowerCase()} OR mac = ${mac} OR hwid = ${hwid}`);
    }

    async allUsers(){
        let data = await this.db.all(SQL`SELECT username FROM Users`);
        return data;
    }
}

class OnlineUsersManager{
    constructor(){
        this.mapOnlineUsers = new Map();
        this.mapOnlineUsersForUsername = new Map();

        this.onlineUsersList = [];
    }

    add(user){
        if(!this.online(user.username)){
            let lower = user.username.toLowerCase();
            this.mapOnlineUsersForUsername.set(lower,user);
            this.mapOnlineUsers.set(user.websocket,user);
            this.onlineUsersList.push(user);
        }
    }

    get(key){
        let user = null;
        if(typeof(key) === "string"){
            user = this.mapOnlineUsersForUsername.get(key.toLowerCase());
        }else{
            user = this.mapOnlineUsers.get(key);
        }
        return user;
    }

    remove(key){
        let user = this.get(key);
        if(user !== undefined){
            let index = this.onlineUsersList.indexOf(user);
            this.onlineUsersList.splice(index,1);

            let lower = user.username.toLowerCase();
            this.mapOnlineUsersForUsername.delete(lower);
            this.mapOnlineUsers.delete(user.websocket);
        }
    }

    forEach(cb){
        for(let user of this.onlineUsersList)
            cb(user);
    }

    online(key){
        let user = this.get(key);
        if(user !== undefined)
            return true;
        return false;
    }

    get list(){
        return this.onlineUsersList;
    }

    get size(){
        return this.onlineUsersList.length;
    }
}

class CommandProcessor extends events.EventEmitter{
    constructor(){
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
        this.register('help',()=>{
            this.printHelp();
        },'display help meesage');
    }

    register(command,func,helpMsg){
        this.map.set(command,{
            func: func,
            helpMsg: helpMsg,
            arguments: this.getArguments(func)
        });
    }

    printHelp(){
        this.map.forEach((v,k)=>{
            console.info(`${k} ${v.arguments.join(' ')} \t\t- ${v.helpMsg}`);
        });
    }

    start(){
        this.rl.on('line', (line) => {
            let breaked = line.split(' ');
            let cmd = this.map.get(breaked[0]);
            if(cmd !== undefined){
                breaked.splice(0,1);
                cmd.func(...breaked);
            }else{
                console.info(`No found '${breaked[0]}' command`.inverse);
                this.printHelp();
            }
        });
    }

    getArguments(fn){
        return /\((\w[0-9A-za-z]*,?)*\)/.exec(fn.toString())[0].replace(/(\(|\))/g,'').replace(/,/g,' ').split(' ');
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
    const CONST_HEART_CHECK_TIMEOUT = 30 * 1000;//30s
    const CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL = 60 * 1000//60s
    const CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL = 30 * 60 * 1000;//30m

    const commandProcessor = new CommandProcessor();
    const onlineUsers = new OnlineUsersManager();
    const usersManager = new UsersManager();
    await usersManager.openDatabase();
    usersManager.isBanned({username: 'KedamaOvO'})

    let ircClient = new irc.Client('irc.ppy.sh', config.ircBotName, {
        port: 6667,
        autoConnect: true,
        userName: config.ircBotName,
        password: config.ircBotPassword
    });

    let ws = new WebSocketServer({
        port: config.port,
        noServer: true,
        verifyClient: (info) => socketVerify(info, config,usersManager),
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

    //websocket event
    ws.on('connection',
        async function (wsocket, request) {
            let cookie = parseCookie(request.headers.cookie);
            let user = {
                websocket: wsocket,
                username: cookie.transfer_target_name,
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
            if(await usersManager.isBanned(user)){
                user.websocket.close();
                return;
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

            //Check that the user is online.
            if (onlineUsers.online(user.username)) {
                if (wsocket.readyState === wsocket.OPEN)
                    wsocket.send(`The TargetUsername is connected! Send "!logout" logout the user to ${config.ircBotName}`);
                wsocket.close();
                return;
            }

            //add new user to database
            if(!await usersManager.exist(user)){
                await usersManager.add(user);
            }

            //add user to onlineUsers set
            onlineUsers.add(user);

            //send welcomeMessage
            if (config.welcomeMessage != null && config.welcomeMessage != "")
                ircClient.say(user.username, config.welcomeMessage);

            if (request.headers["botredirectfrom"] !== undefined) {
                wsocket.send("Your current MikiraSora's PublicBotTransferPlugin server is about to close. Please go to https://github.com/MikiraSora/PublicBotTransferPlugin/releases to download the latest version of the plugin and extract it to the Sync root directory.")
            }
            wsocket.send(`You can send ${config.maxMessageCountPerMinute} messages per minute`);

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
        let list = [];
        onlineUsers.list.forEach(user => {
            if (date - user.lastSendTime > CONST_CLEAR_NO_RESPONSE_USER_DATE_INTERVAL) {
                list.push(user);
            }
        });

        let str = "Clear Users: ";

        for (let user of list) {
            str += `${user.username}\t`;
            user.websocket.close();
        }
        if (list.length !== 0)
            console.log(str);
    }, CONST_CLEAR_NO_RESPONSE_USER_TIMER_INTERVAL);

    commandProcessor.register('sendtoirc',function(target,msg){
        if (onlineUsers.online(target)) {
            ircClient.say(target, msg);
        } else {
            console.info("[Command] User no connented".inverse);
        }
    },'send message to user via irc');

    commandProcessor.register('sendtosync',function(target,msg){
        if (onlineUsers.online(target)) {
            let user = onlineUsers.get(target);
            user.websocket.send(msg);
        } else {
            console.info("[Command] User no connented".inverse);
        }
    },'send message to user via sync');

    commandProcessor.register('onlineusers',function(){
        let str = '';
        onlineUsers.forEach(user => str += `${user.username}\t`);
        console.info(str);
        console.info('--------------------------')
        console.info(`Count: ${onlineUsers.size}`);
    },'send message to user via sync');

    commandProcessor.register('allusers',async function(){
        let list = await usersManager.allUsers();
        let str = '';

        list.forEach(res => str += `${res["username"]}\t`);
        console.info(str);
        console.info('--------------------------')
        console.info(`Count: ${list.length}`);
    });

    commandProcessor.register('ban',async function(username){
        let user = onlineUsers.get(username) || { username: username };

        if(!await usersManager.isBanned(user)){
            await usersManager.ban(user);
            ircClient.say(user.username,'You are banned!');
            if(user.websocket !== undefined){
                user.websocket.send('You are banned!');
                user.websocket.close();
            }
        }else{
            console.info(`${user.username} was banned!`);
        }
    },'ban');

    commandProcessor.register('unban',async function(username){
        if(await usersManager.isBanned({username:username})){
            await usersManager.unban(username);
        }else{
            console.info(`${user.username} wasn't banned!`);
        }
    });

    commandProcessor.on('exit',function(){
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