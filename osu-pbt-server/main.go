package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/op/go-logging"
)

type Config struct {
	//irc
	Username string `json:"ircBotName"`
	Password string `json:"ircBotPassword"`

	//ws
	Port int32  `json:"port"`
	Path string `json:"path"`

	//bot
	WelcomeMessage           string `josn:"welcomeMessage"`
	MaxMessageCountPerMinute int32  `json:"maxMessageCountPerMinute"`

	//Osu Api
	APIKey string `json:"apiKey"`
}

var config Config
var osuAPI *OsuApi
var userManager = NewUserManager()

var log = logging.MustGetLogger("pbt-go")
var format = logging.MustStringFormatter(
	`%{color}%{time:15:04:05.000} %{shortfunc} [%{level:.4s}] <%{id:03x}>%{color:reset} %{message}`,
)

func initServer() {
	//load config
	if jsonBytes, err := ioutil.ReadFile("config.json"); err != nil {
		panic("Can't load config.json")
	} else {
		if err := json.Unmarshal(jsonBytes, &config); err != nil {
			panic("Can't parse config.json")
		}
	}

	if _, err := os.Stat("logs"); os.IsNotExist(err) {
		os.Mkdir("logs", os.ModePerm)
	}

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
}

func initStdinCommand(cm *CommandManager, bukkit *UserBukkit) {
	cm.AddCallback("online", func(from string, args []string, o io.Writer) {
		for _, v := range bukkit.bukkit {
			fmt.Fprintf(o, "%s\t", v.user.Username)
		}
		fmt.Fprintf(o, "\nCount: %d\n\n", len(bukkit.bukkit))
	}, "\t\t\tAll online user", 0)

	cm.AddCallback("toirc", func(from string, args []string, o io.Writer) {
		c, ok := bukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n", args[0])
			return
		}
		msg := strings.Join(args[1:], " ")
		c.SendMessageToIRC(msg)
	}, "[username] [msg]\tSend a Message to IRC", 2)

	cm.AddCallback("tosync", func(from string, args []string, o io.Writer) {
		c, ok := bukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n", args[0])
			return
		}
		msg := strings.Join(args[1:], " ")
		c.SendNoticeToWS(msg)
	}, "[username] [msg]\tSend a Message to Sync", 2)

	cm.AddCallback("kick", func(from string, args []string, o io.Writer) {
		bukkit.Kick(args[0], "You are taken offline by the administrator.")
	}, "[username]\t\tLet a user go offline", 1)

	cm.AddCallback("ban", func(from string, args []string, o io.Writer) {
		u, ok := userManager.GetUserByUsername(args[0])
		if !ok {
			fmt.Fprintf(o, "User(%s) does not exist.\n", args[0])
			return
		}
		minutes, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil {
			fmt.Fprintf(o, "minutes format is incorrect.\n")
			return
		}
		u.Ban(time.Duration(minutes) * time.Minute)
		bukkit.Kick(args[0], "You are ban by the administrator.")
		userManager.Update(u)
	}, "[username] [minutes]\tBan a user", 2)

	cm.AddCallback("unban", func(from string, args []string, o io.Writer) {
		u, ok := userManager.GetUserByUsername(args[0])
		if !ok {
			fmt.Fprintf(o, "User(%s) does not exist.\n", args[0])
			return
		}
		u.Unban()
		userManager.Update(u)
	}, "[username]\t\tUnban a user", 1)
}

func initIrcCommand(cm *CommandManager, bukkit *UserBukkit) {
	cm.AddCallback("logout", func(from string, args []string, o io.Writer) {
		bukkit.Kick(from, fmt.Sprintf("You are taken offline by the %s.", from))
	}, "", 0)
}

func main() {
	initServer()
	stdinCmd := NewCommandManager(true)
	ircCmd := NewCommandManager(false)
	bukkit := NewBukkit()
	irc := NewIrc(bukkit, ircCmd)
	initStdinCommand(stdinCmd, bukkit)
	initIrcCommand(ircCmd, bukkit)
	go bukkit.Run()
	go stdinCmd.ReadStdinPump()
	go stdinCmd.Run()
	go ircCmd.Run()

	http.HandleFunc(config.Path, func(rw http.ResponseWriter, req *http.Request) {
		nameCookie, err := req.Cookie("transfer_target_name")
		if err != nil {
			rw.WriteHeader(http.StatusForbidden)
			req.Body.Close()
			return
		}

		name := strings.Replace(nameCookie.Value, " ", "_", -1)
		StartWS(name, bukkit, irc, rw, req)
	})

	http.HandleFunc("/is_online", func(rw http.ResponseWriter, req *http.Request) {
		onlineJson := struct {
			Online bool `json:"online"`
		}{
			Online: false,
		}

		query := req.URL.Query()
		name, ok := query["u"]
		if !ok || len(name[0]) < 1 {
			json, _ := json.Marshal(onlineJson)
			rw.Write(json)
			return
		}

		if !bukkit.IsOnline(name[0]) {
			json, _ := json.Marshal(onlineJson)
			rw.Write(json)
			return
		}

		onlineJson.Online = true
		json, _ := json.Marshal(onlineJson)
		rw.Write(json)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", config.Port)
	log.Infof("[Server] Listenning %s", addr)
	err := http.ListenAndServe(addr, nil)
	if err != nil {
		log.Fatal(err)
	}
}
