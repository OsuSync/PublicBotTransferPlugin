package main

import "github.com/gorilla/websocket"

type UserBukkit struct {
	bukkit map[string]*Client

	add    chan *Client
	remove chan *Client
}

func (b *UserBukkit) GetClient(name string) (*Client, bool) {
	c, ok := b.bukkit[name]
	if !ok {
		return nil, false
	}
	return c, true
}

func (b *UserBukkit) Kick(name string, reason string) {
	c, ok := b.bukkit[name]
	if ok {
		c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason))
		c.conn.Close()
	}
}

func (b *UserBukkit) IsOnline(name string) bool {
	if _, ok := b.bukkit[name]; ok {
		return true
	}
	return false
}

func (b *UserBukkit) Run() {
	for {
		select {
		case c := <-b.add:
			b.bukkit[c.user.Username] = c
		case c := <-b.remove:
			delete(b.bukkit, c.user.Username)
		}
	}
}

func NewBukkit() *UserBukkit {
	return &UserBukkit{
		bukkit: make(map[string]*Client),

		add:    make(chan *Client, 64),
		remove: make(chan *Client, 64),
	}
}
