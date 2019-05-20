package main

import (
	"strings"

	irc "github.com/thoj/go-ircevent"
)

type IRCWirter struct {
	name string
	irc  *irc.Connection
}

func (iw IRCWirter) Write(p []byte) (n int, err error) {
	iw.irc.Privmsg(iw.name, string(p))
	return len(p), nil
}

func NewIrc(bukkit *UserBukkit, cm *CommandManager) *irc.Connection {
	irccon := irc.IRC(config.Username, config.Username)
	//irccon.VerboseCallbackHandler = true
	//irccon.Debug = true
	irccon.Password = config.Password

	irccon.AddCallback("001", func(e *irc.Event) {
		log.Infof("[IRC] %s", e.Message())
	})
	irccon.AddCallback("PRIVMSG", func(e *irc.Event) {
		if e.Nick == config.Username {
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

		log.Infof("[WS <- IRC] %s: %s", e.Nick, msg)
		c, ok := bukkit.GetClient(e.Nick)
		if !ok {
			log.Errorf("%s is offline.", e.Nick)
			return
		}
		c.SendMessageToWS(e.Message())
	})

	err := irccon.Connect("irc.ppy.sh:6667")
	if err != nil {
		log.Fatal(err)
	}

	go irccon.Loop()

	return irccon
}
