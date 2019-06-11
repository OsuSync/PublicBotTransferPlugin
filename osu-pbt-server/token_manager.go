package main

import "github.com/lithammer/shortuuid"

type addTokenTuple struct {
	client *Client
	token  string
}

type TokenManager struct {
	clientTokenMap map[*Client]string

	addToken    chan addTokenTuple
	removeToken chan *Client
}

func (tm *TokenManager) RequestToken(c *Client) string {
	guid := shortuuid.New()

	tm.addToken <- addTokenTuple{
		client: c,
		token:  guid,
	}

	return guid
}

func (tm *TokenManager) RemoveToken(c *Client) {
	tm.removeToken <- c
}

func (tm *TokenManager) Token(c *Client) (string, bool) {
	if token, ok := tm.clientTokenMap[c]; ok {
		return token, true
	}
	return "", false
}

func (tm *TokenManager) TokenRequested(c *Client) bool {
	if _, ok := tm.clientTokenMap[c]; ok {
		return true
	}
	return false
}

func (tm *TokenManager) loop() {
	for {
		select {
		case tuple := <-tm.addToken:
			tm.clientTokenMap[tuple.client] = tuple.token

		case client := <-tm.removeToken:
			delete(tm.clientTokenMap, client)
		}
	}
}

func NewTokenManager() *TokenManager {
	tm := &TokenManager{
		clientTokenMap: make(map[*Client]string),
		addToken:       make(chan addTokenTuple, 16),
		removeToken:    make(chan *Client, 16),
	}

	go tm.loop()
	return tm
}
