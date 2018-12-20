# Public ~~RBQ~~ Osu!IRC bot message transfer plugin
This Sync plugin able to transfer your message between LiveRoom/SyncPlugin and you.<br/> It need a [API key](http://mikirasora.moe/account/api) for authoriztion.

### Principle/Implement

LiveRoomChat <---> Sync <---> Websocket+PublicOsuBot <---> Osu!IRC

### Config in config.ini
**[PublicOsuBotTransferPlugin.OsuBotTransferClient]** <br/>

Name|Value Type|Default Value|Decription
---|---|---|---
Target_User_Name|string||User name which you want bot to transfer to|

### Notice
This bot **send interval** for all user is 300ms , it will **be automatic to combime messages if bot receive more message**.

### Usage
[Video Tutorial](https://puu.sh/AOACO/056147cb4a.mp4)

### Screenshot
![](https://puu.sh/AMSQs/8a5ae9523c.png)
