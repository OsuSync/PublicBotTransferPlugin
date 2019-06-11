package main

// Config is PBT-GO configuration struct
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
