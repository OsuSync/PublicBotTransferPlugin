package main

import (
	irc "github.com/thoj/go-ircevent"
)

type IRCWirter struct {
	name string //irc nick
	irc  *irc.Connection
}

func (iw IRCWirter) Write(p []byte) (n int, err error) {
	iw.irc.Privmsg(iw.name, string(p))
	return len(p), nil
}
