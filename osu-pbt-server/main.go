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

var (
	config     Config
	osuAPI     *OsuAPI
	ircManager *IRCManager

	userManager = NewUserManager() // database users
	userBukkit  = NewBukkit()      // online users
)

var (
	log    = logging.MustGetLogger("pbt-go")
	format = logging.MustStringFormatter(
		`%{color}%{time:15:04:05.000} %{shortfunc} [%{level:.4s}] <%{id:03x}>%{color:reset} %{message}`,
	)
)

func initStdinCommand(cm *CommandManager) {
	cm.AddCallback("online", func(from string, args []string, o io.Writer) {
		for _, v := range userBukkit.bukkit {
			fmt.Fprintf(o, "%s\t", v.user.Username)
		}
		fmt.Fprintf(o, "\nCount: %d\n\n", len(userBukkit.bukkit))
	}, "\t\t\tAll online user", 0)

	cm.AddCallback("toirc", func(from string, args []string, o io.Writer) {
		c, ok := userBukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n", args[0])
			return
		}
		msg := strings.Join(args[1:], " ")
		c.SendMessageToIRC(msg)
	}, "[username] [msg]\tSend a Message to IRC", 2)

	cm.AddCallback("tosync", func(from string, args []string, o io.Writer) {
		c, ok := userBukkit.GetClient(args[0])
		if !ok {
			fmt.Fprintf(o, "%s is offline.\n", args[0])
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
			fmt.Fprintf(o, "User(%s) does not exist.\n", args[0])
			return
		}
		minutes, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil {
			fmt.Fprintf(o, "minutes format is incorrect.\n")
			return
		}
		u.Ban(time.Duration(minutes) * time.Minute)
		userBukkit.Kick(args[0], "You are ban by the administrator.")
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

func initIrcCommand(cm *CommandManager) {
	cm.AddCallback("logout", func(from string, args []string, o io.Writer) {
		userBukkit.Kick(from, fmt.Sprintf("You are taken offline by the %s.", from))
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
	ircCmd := NewCommandManager(false)
	ircManager = NewIrc(ircCmd)
	initStdinCommand(stdinCmd)
	initIrcCommand(ircCmd)
	go userBukkit.Run()
	go stdinCmd.ReadStdinPump()
	go stdinCmd.Run()
	go ircCmd.Run()
}

func main() {
	initServer()

	http.HandleFunc(config.Path, func(rw http.ResponseWriter, req *http.Request) {
		nameCookie, err := req.Cookie("transfer_target_name")
		if err != nil {
			rw.WriteHeader(http.StatusForbidden)
			req.Body.Close()
			return
		}

		name := strings.Replace(nameCookie.Value, " ", "_", -1)
		StartWS(name, rw, req)
	})

	http.HandleFunc("/is_online", func(rw http.ResponseWriter, req *http.Request) {
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

	addr := fmt.Sprintf("127.0.0.1:%d", config.Port)
	log.Infof("[Server] Listenning %s", addr)
	err := http.ListenAndServe(addr, nil)
	if err != nil {
		log.Fatal(err)
	}
}
