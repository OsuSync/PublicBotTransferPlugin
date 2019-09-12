package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/go-version"
	"github.com/op/go-logging"
)

var (
	config     Config
	osuAPI     *OsuAPI
	ircManager *IRCManager

	userManager = NewUserManager() // database users
	userBukkit  = NewBukkit()      // online users

	tokenManager = NewTokenManager()
)

var (
	log    = logging.MustGetLogger("pbt-go")
	format = logging.MustStringFormatter(
		"\r%{color}%{time:15:04:05.000} %{shortfunc} [%{level:.4s}] <%{id:03x}>%{color:reset} %{message}\r",
	)
)

func initStdinCommand(cm *CommandManager) {
	cm.AddCallback("online", func(from string, args []string, o io.Writer) {
		for _, v := range userBukkit.bukkit {
			fmt.Fprintf(o, "%s\t", v.user.Username)
		}
		fmt.Fprintf(o, "\r\n\033[32mCount: %d\033[37m\n\n\r", len(userBukkit.bukkit))
	}, "\t\t\tAll online user", 0)

	cm.AddCallback("toirc", func(from string, args []string, o io.Writer) {
		c, ok := userBukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n\r", args[0])
			return
		}
		msg := strings.Join(args[1:], " ")
		c.SendMessageToIRC(msg)
	}, "[username] [msg]\tSend a Message to IRC", 2)

	cm.AddCallback("tosync", func(from string, args []string, o io.Writer) {
		c, ok := userBukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n\r", args[0])
			return
		}
		msg := strings.Join(args[1:], " ")

		c.SendNoticeToWS(msg)
	}, "[username] [msg]\tSend a Message to Sync", 2)

	cm.AddCallback("kick", func(from string, args []string, o io.Writer) {
		userBukkit.Kick(args[0], "You are taken offline by the administrator.")
	}, "[username]\t\tLet a user go offline", 1)

	cm.AddCallback("ban", func(from string, args []string, o io.Writer) {
		u, ok := userManager.GetUserByUsername(args[0])
		if !ok {
			fmt.Fprintf(o, "User(%s) does not exist.\n\r", args[0])
			return
		}
		minutes, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil {
			fmt.Fprintf(o, "minutes format is incorrect.\n\r")
			return
		}
		u.Ban(time.Duration(minutes) * time.Minute)
		userBukkit.Kick(args[0], "You are ban by the administrator.")
		userManager.Update(u)
	}, "[username] [minutes]\tBan a user", 2)

	cm.AddCallback("unban", func(from string, args []string, o io.Writer) {
		u, ok := userManager.GetUserByUsername(args[0])
		if !ok {
			fmt.Fprintf(o, "User(%s) does not exist.\n\r", args[0])
			return
		}
		u.Unban()
		userManager.Update(u)
	}, "[username]\t\tUnban a user", 1)
	
	cm.AddCallback("quit", func(from string, args []string, o io.Writer) {
		cm.QuitStdinPump()
		os.Exit(0)
	},"\t\t\tQuit server",0)
}

func initIrcCommand(cm *CommandManager) {
	cm.AddCallback("logout", func(from string, args []string, o io.Writer) {
		userBukkit.Kick(from, fmt.Sprintf("You are taken offline by the %s.", from))
	}, "", 0)

	cm.AddCallback("assign_token", func(from string, args []string, o io.Writer) {
		var c *Client
		var ok bool
		if c, ok = userBukkit.GetClient(from); !ok {
			fmt.Fprint(o, "Your Sync is offline.")
			return
		}

		c.status &= ^WAIT_IRC_RPL

		if c.version.LessThan(VERSION) {
			fmt.Fprintf(o, "The PublicOsuBotTransfer plugin that is lower than the %s version does not support this command.", VERSION)
			return
		}

		if tokenManager.TokenRequested(c) {
			fmt.Fprint(o, "You have already assigned a token.")
			return
		}

		token := tokenManager.RequestToken(c)
		tokenBytes := []byte(token)
		buf := &bytes.Buffer{}
		binary.Write(buf, binary.LittleEndian, struct {
			cmd uint16
			len int32
		}{
			cmd: RPL_TOKEN,
			len: int32(len(tokenBytes)),
		})
		log.Infof("[Generate Token] %s: %s", c.user.Username, token)
		c.SendBinaryToWS(append(buf.Bytes(), tokenBytes...))

	}, "", 0)
}

func initServer() {
	//load config
	if jsonBytes, err := ioutil.ReadFile("config.json"); err != nil {
		panic("Can't load config.json")
	} else {
		if err := json.Unmarshal(jsonBytes, &config); err != nil {
			panic("Can't parse config.json")
		}
	}

	// Is the logs folder exist? if no, create it.
	if _, err := os.Stat("logs"); os.IsNotExist(err) {
		os.Mkdir("logs", os.ModePerm)
	}

	// osu web api
	osuAPI = NewOsuAPI(config.APIKey)
	logFile, err := os.OpenFile(fmt.Sprintf("logs/log-%s.log", time.Now().Format("20060102-15-04-05")), os.O_WRONLY|os.O_TRUNC|os.O_CREATE, os.ModePerm)
	if err != nil {
		panic(err)
	}

	fileBackend := logging.NewLogBackend(logFile, "", 0)
	stdoutBackend := logging.NewLogBackend(os.Stdout, "", 0)

	fileBackendFormatter := logging.NewBackendFormatter(fileBackend, format)
	stdoutBackendFormatter := logging.NewBackendFormatter(stdoutBackend, format)

	logging.SetBackend(fileBackendFormatter, stdoutBackendFormatter)

	stdinCmd := NewCommandManager(true)
	initStdinCommand(stdinCmd)
	go stdinCmd.ReadStdinPump()

	ircCmd := NewCommandManager(false)
	initIrcCommand(ircCmd)

	ircManager = NewIrc(ircCmd)
	go userBukkit.Run()
}

func main() {
	initServer()

	http.HandleFunc(config.Path, func(rw http.ResponseWriter, req *http.Request) {
		nameCookie, err := req.Cookie("transfer_target_name")
		if err != nil {
			rw.WriteHeader(http.StatusBadRequest)
			return
		}

		var versionStr string
		versionCookie, err := req.Cookie("version")
		if err != nil {
			versionStr = "1.0.0"
		} else {
			versionStr = versionCookie.Value
		}

		ver := version.Must(version.NewVersion(versionStr))

		name := strings.Replace(nameCookie.Value, " ", "_", -1)
		StartWS(name, rw, req, ver)
	})

	http.HandleFunc("/api/is_online", func(rw http.ResponseWriter, req *http.Request) {
		onlineJSON := struct {
			IRCOnline  bool `json:"ircOnline"`
			SyncOnline bool `json:"syncOnline"`
		}{
			IRCOnline:  false,
			SyncOnline: false,
		}

		query := req.URL.Query()
		name, ok := query["u"]
		if !ok || len(name[0]) < 1 {
			json, _ := json.Marshal(onlineJSON)
			rw.Write(json)
			return
		}
		name[0] = strings.Replace(name[0], " ", "_", -1)
		if userBukkit.IsOnline(name[0]) {
			onlineJSON.SyncOnline = true
		}

		if ircManager.IsOnline(name[0]) {
			onlineJSON.IRCOnline = true
		}

		json, _ := json.Marshal(onlineJSON)
		rw.Write(json)
	})

	http.HandleFunc("/api/token_valid", func(rw http.ResponseWriter, req *http.Request) {
		validJSON := struct {
			Valid bool `json:"valid"`
		}{
			Valid: false,
		}

		query := req.URL.Query()
		if name, ok := query["u"]; ok && len(name) > 0 {
			if k, ok := query["k"]; ok && len(k) > 0 {
				if c, ok := userBukkit.GetClient(name[0]); ok {
					if token, ok := tokenManager.Token(c); ok {
						if k[0] == token {
							validJSON.Valid = true
						}
					}
				}
			}
		}

		json, _ := json.Marshal(validJSON)
		rw.Write(json)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", config.Port)
	log.Infof("[Server] Listenning %s", addr)
	err := http.ListenAndServe(addr, nil)
	if err != nil {
		log.Fatal(err)
	}
}
