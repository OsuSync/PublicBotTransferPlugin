package main

import (
	"strings"

	mapset "github.com/deckarep/golang-set"
	irc "github.com/thoj/go-ircevent"
)

// IRCManager is a irc manager
type IRCManager struct {
	irc   *irc.Connection
	users mapset.Set
}

// SendMessage send a message to osu.ppy.sh
func (irc *IRCManager) SendMessage(name string, msg string) {
	irc.irc.Privmsg(name, msg)
}

// IsOnline check a user is online or not
func (irc *IRCManager) IsOnline(name string) bool {
	return irc.users.Contains(name)
}

// NewIrc create a IRC Client connected osu.ppy.sh
func NewIrc(cm *CommandManager) *IRCManager {
	irccon := irc.IRC(config.Username, config.Username)
	//irccon.VerboseCallbackHandler = true
	//irccon.Debug = true
	irccon.Password = config.Password

	ircManager := &IRCManager{
		irc:   irccon,
		users: mapset.NewSet(),
	}

	irccon.AddCallback("001", func(e *irc.Event) {
		log.Infof("[IRC] %s", e.Message())
		ircManager.users.Clear()
		log.Info("[IRC] Join the #osu channel")
		irccon.Join("#osu")
	})

	//user list handle
	irccon.AddCallback("353", func(e *irc.Event) {
		nicks := strings.Split(e.Arguments[3], " ")
		for _, nick := range nicks {
			ircManager.users.Add(nick)
		}
	})

	irccon.AddCallback("QUIT", func(e *irc.Event) {
		ircManager.users.Remove(e.Nick)
	})

	irccon.AddCallback("JOIN", func(e *irc.Event) {
		ircManager.users.Add(e.Nick)
	})

	//handle message
	irccon.AddCallback("PRIVMSG", func(e *irc.Event) {
		if e.Nick == config.Username {
			return
		}

		channel := e.Arguments[0]
		if channel == "#osu" {
			return
		}

		msg := e.Message()

		//is command
		if strings.HasPrefix(msg, "!") {
			trimedMsg := strings.TrimPrefix(msg, "!")
			log.Infof("[IRC Command] %s: %s", e.Nick, msg)
			cm.PushCommandEx(e.Nick, trimedMsg, IRCWirter{
				name: e.Nick,
				irc:  irccon,
			})
			return
		}

		c, ok := userBukkit.GetClient(e.Nick)
		if !ok {
			log.Infof("[WS(offline) <- IRC] %s: %s", e.Nick, msg)
			return
		}
		log.Infof("[WS <- IRC] %s: %s", e.Nick, msg)
		c.SendMessageToWS(e.Message())
	})

	err := irccon.Connect("irc.ppy.sh:6667")
	if err != nil {
		log.Fatal(err)
	}

	go irccon.Loop()

	return ircManager
}
