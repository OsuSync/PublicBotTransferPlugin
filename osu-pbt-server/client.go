package main

import (
	"bytes"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	irc "github.com/thoj/go-ircevent"
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

var (
	syncNoticeHeader = []byte{0x1, 0x3, 0x1}

	//compatibility
	heartPingFlag = []byte("\x01\x01HEARTCHECK")
	heartPongFlag = "\x01\x02HEARTCHECKOK"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Client struct {
	bukkit *UserBukkit
	irc    *irc.Connection
	user   *User

	conn *websocket.Conn

	sendToWs      chan []byte
	quitWritePump chan bool

	messageCount int32
}

func (c *Client) SendMessageToWS(text string) {
	var textBytes = []byte(text)
	c.sendToWs <- textBytes
}

func (c *Client) SendNoticeToWS(text string) {
	var buffer bytes.Buffer
	buffer.Write(syncNoticeHeader)
	buffer.WriteString(text)
	c.sendToWs <- buffer.Bytes()
}

func (c *Client) SendMessageToIRC(text string) {
	c.irc.Privmsg(c.user.Username, text)
}

func (c *Client) readPumpWs() {
	defer func() {
		c.bukkit.remove <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		msgType, message, err := c.conn.ReadMessage()

		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Errorf("%s : %v", c.user.Username, err)
			}
			c.quitWritePump <- true
			break
		}

		switch msgType {
		case websocket.TextMessage:
			//compatibility
			if bytes.HasPrefix(message, heartPingFlag) {
				c.conn.SetReadDeadline(time.Now().Add(pongWait))
				c.SendMessageToWS(heartPongFlag)
				continue
			}

			if c.messageCount > config.MaxMessageCountPerMinute {
				c.SendMessageToWS("Exceeded the limit on the number of messages sent per minute.")
				continue
			}
			atomic.AddInt32(&c.messageCount, 1)

			message := string(bytes.TrimSpace(bytes.Replace(message, newline, space, -1)))

			log.Infof("[WS -> IRC] %s: %s", c.user.Username, message)
			c.SendMessageToIRC(message)
		}
	}
}

func (c *Client) writePumpWs() {
	pingTicker := time.NewTicker(pingPeriod)
	msgCountClearTicker := time.NewTicker(time.Minute)
	defer func() {
		pingTicker.Stop()
		msgCountClearTicker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msgBytes, ok := <-c.sendToWs:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			c.conn.WriteMessage(websocket.TextMessage, msgBytes)

		case <-pingTicker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-c.quitWritePump:
			return

		case <-msgCountClearTicker.C:
			oldValue := c.messageCount
			for {
				if atomic.CompareAndSwapInt32(&c.messageCount, oldValue, 0) {
					break
				}
			}
		}
	}
}

func getUser(name string) (*User, bool) {
	//try get user from database
	user, ok := userManager.GetUserByUsername(name)
	if ok {
		return user, true
	}

	//get uid from osu.ppy.sh
	uid, ok := osuAPI.GetUidByUsername(name)
	if !ok {
		return nil, false
	}

	if userManager.ExistByUID(uid) {
		user, ok = userManager.GetUserByUID(uid)
		if !ok {
			return nil, false
		}

		user.Username = name
		userManager.Update(user)
	} else {
		user = &User{
			UID:            uid,
			Username:       name,
			FirstLoginDate: now(),
		}
		userManager.Add(user)
	}

	return user, true
}

func StartWs(name string, b *UserBukkit, irc *irc.Connection, w http.ResponseWriter, r *http.Request) {
	user, ok := getUser(name)
	if !ok {
		r.Body.Close()
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error(err)
		return
	}

	if user.IsBanned() {
		eta := user.GetBannedETA()
		if eta != 0 {
			minutes := eta / time.Minute
			seconds := eta/time.Second - minutes*60
			reason := fmt.Sprintf("Your are restricted! %d minutes %d seconds without restrictions.", minutes, seconds)
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason))
			conn.Close()
			return
		}
		user.Unban()
		userManager.Update(user)
	}

	if b.IsOnline(name) {
		reason := fmt.Sprintf(`The TargetUsername is connected! Send "!logout" logout the user to %s`, config.Username)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason))
		conn.Close()
	}

	c := &Client{
		bukkit:        b,
		user:          user,
		irc:           irc,
		conn:          conn,
		sendToWs:      make(chan []byte, 64),
		quitWritePump: make(chan bool),
	}

	c.bukkit.add <- c

	c.SendNoticeToWS(config.WelcomeMessage)
	//c.sendMessageToIrc(config.WelcomeMessage)

	go c.readPumpWs()
	go c.writePumpWs()
}
