# Public ~~RBQ~~ Osu!IRC bot message transfer plugin
This Sync plugin allow you transfer your message between LiveRoom/SyncPlugin and you.<br/> It need a API key in my website for authoriztion.

### Principle/Implement

LiveRoomChat <---> Sync <---> Websocket+PublicOsuBot <---> Osu!IRC

### Config in config.ini
**[PublicOsuBotTransferPlugin.OsuBotTransferClient]** <br/>

Name|Value Type|Default Value|Decription
---|---|---|---
Target_User_Name|string||User name which you want bot to transfer to|
API_Key|string||API Key for connect authoriztion ([Apply for api](http://mikirasora.moe/account/api))|
