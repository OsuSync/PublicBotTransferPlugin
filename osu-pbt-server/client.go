package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/go-version"
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

	//Unranked Mod
	unrankedMods = [...]string{"RL","Auto","AP","V2","CN","Co-op","RD","1K","2K","3K","4K","5K","6K","7K","8K","9K"}
)

var rtppdMsgRegex = regexp.MustCompile(`\[RTPPD\]\[(?:http(?:s)?:\/\/osu\.ppy\.sh\/b\/(\d+)).+](?:\s(\+(?:\w*,?)*))?\s+\|\s\d+.\d+%\s=>\s\d+(?:\.|\,)\d+pp\s\((\w+)\)`)

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

// Client Status
// bit flags
const (
	CONNECTED    uint32 = 1
	WAIT_IRC_RPL uint32 = 2
)

// Client is a connected user instance
type Client struct {
	user    *User
	version *version.Version

	conn *websocket.Conn

	sendToWs       chan []byte
	sendBinaryToWS chan []byte
	quitWritePump  chan bool

	//var
	recentTime          time.Time
	sentIrcMessageCount int32

	status uint32
}

func (c *Client) SendBinaryToWS(bin []byte) {
	c.sendBinaryToWS <- bin
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
	ircManager.SendMessage(c.user.Username, text)
}

const timeLayoutOSU = "2006-01-02 15:04:05"

//Process RTPPD Notify
func (c *Client) processRtppdMsg(msg []byte) {
	match := rtppdMsgRegex.FindSubmatch(msg)

	defer func(){
		log.Infof("[WS -> IRC] %s: %s", c.user.Username, msg)
		c.SendMessageToIRC(string(msg))
	}()

	if len(match) > 0 {
		if len(match[1]) > 0 && len(match[2]) > 0 {
			beatmapID, err := strconv.ParseInt(string(match[1]), 10, 64)
			mods := string(match[2])
			mode := modeStringToInt(string(match[3]))
			if err != nil || mode == -1 {
				return
			}

			for _,mod := range unrankedMods{
				if strings.Contains(mods,mod){
					return
				}
			}

			b, ok := osuAPI.GetBeatmap(beatmapID)
			if !ok {
				return
			}

			if b["approved"].(string) != "1" {
				return
			}

			recentOK := false
			nowTime := time.Now()
			for i := 0; i < 5; i++ {
				recent, ok := osuAPI.GetUserRecent(fmt.Sprint(c.user.UID), "id", mode, 1)
				if !ok {
					return
				}
				t, err := time.Parse(timeLayoutOSU, recent["date"].(string))
				if err != nil {
					return
				}
				if c.recentTime.Before(t) && math.Abs(nowTime.Sub(t).Seconds()) < 30 {
					c.recentTime = t
					recentOK = true
					break
				}
				time.Sleep(1 * time.Second)
			}
			if !recentOK {
				return
			}

			//wait bancho update pp
			time.Sleep(1 * time.Second)
			pp, ok := osuAPI.GetUserPP(c.user.UID, mode)
			if !ok {
				return
			}

			var deltaPP float64
			switch mode {
			case 0:
				deltaPP = pp - c.user.StdPP
				c.user.StdPP = pp

			case 1:
				deltaPP = pp - c.user.TaikoPP
				c.user.TaikoPP = pp

			case 2:
				deltaPP = pp - c.user.CtbPP
				c.user.CtbPP = pp

			case 3:
				deltaPP = pp - c.user.ManiaPP
				c.user.ManiaPP = pp
			}

			userManager.Update(c.user)

			var buffer bytes.Buffer
			buffer.Write(msg)
			fmt.Fprintf(&buffer, " (%+.2fpp)", deltaPP)

			msg = buffer.Bytes()
		}
	}
}

func (c *Client) readPumpWS() {
	defer func() {
		userBukkit.remove <- c
		if tokenManager.TokenRequested(c) {
			tokenManager.RemoveToken(c)
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		msgType, message, err := c.conn.ReadMessage()

		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Warningf("%s : %v", c.user.Username, err)
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

			if c.sentIrcMessageCount > config.MaxMessageCountPerMinute {
				c.SendMessageToWS("Exceeded the limit on the number of messages sent per minute.")
				continue
			}
			atomic.AddInt32(&c.sentIrcMessageCount, 1)
			message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))

			if !ircManager.IsOnline(c.user.Username) {
				log.Infof("[WS -> IRC(offline)] %s: %s", c.user.Username, message)
				continue
			}

			//process RTPPD message
			if bytes.HasPrefix(message, []byte("[RTPPD]")) {
				go c.processRtppdMsg(message)
			} else {
				log.Infof("[WS -> IRC] %s: %s", c.user.Username, message)
				c.SendMessageToIRC(string(message))
			}
		case websocket.BinaryMessage:
			if len(message) >= 2 {
				if (c.status & WAIT_IRC_RPL) > 0 {
					continue
				}

				cmd := binary.LittleEndian.Uint16(message)
				if cmd == REQ_TOKEN {
					c.SendMessageToIRC(`Sync wants to request other services that the Token uses to access the Bot. Reply "!assign_token" to generate and send a token to Sync.`)
					c.status |= WAIT_IRC_RPL
					time.AfterFunc(60*time.Second, func() {
						c.status &= ^WAIT_IRC_RPL
					})
				}
			}
		}
	}
}

func (c *Client) writePumpWS() {
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

		case binBytes, ok := <-c.sendBinaryToWS:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			c.conn.WriteMessage(websocket.BinaryMessage, binBytes)

		case <-pingTicker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-c.quitWritePump:
			return

		case <-msgCountClearTicker.C:
			oldValue := c.sentIrcMessageCount
			for {
				if atomic.CompareAndSwapInt32(&c.sentIrcMessageCount, oldValue, 0) {
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
		if user.ApplyUserPPFromPpy() {
			userManager.Update(user)
		}
		return user, true
	}

	//get uid from osu.ppy.sh
	u, ok := osuAPI.GetUser(name, "string", 0)
	if !ok {
		return nil, false
	}

	uid, err := strconv.ParseInt(u["user_id"].(string), 10, 64)
	if err != nil {
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
		user.ApplyUserPPFromPpy()
		userManager.Update(user)
	}

	return user, true
}

func StartWS(name string, w http.ResponseWriter, r *http.Request, ver *version.Version) {
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

	if userBukkit.IsOnline(name) {
		reason := fmt.Sprintf(`The TargetUsername is connected! Send "!logout" logout the user to %s`, config.Username)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, reason))
		conn.Close()
	}

	c := &Client{
		version:        ver,
		user:           user,
		conn:           conn,
		sendToWs:       make(chan []byte, 64),
		sendBinaryToWS: make(chan []byte, 64),
		quitWritePump:  make(chan bool),
		status:         CONNECTED,
	}

	userBukkit.add <- c

	c.SendNoticeToWS(config.WelcomeMessage)
	c.SendNoticeToWS(fmt.Sprintf("You can send %d messages per minute", config.MaxMessageCountPerMinute))
	//c.sendMessageToIrc(config.WelcomeMessage)

	go c.readPumpWS()
	go c.writePumpWS()
}
