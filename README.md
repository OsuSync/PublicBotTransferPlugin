# Public ~~RBQ~~ Osu!IRC bot message transfer plugin
This Sync plugin able to transfer your message between LiveRoom/SyncPlugin and you.<br/>

### Principle/Implement
                             Websocket                     IRC
    LiveRoomChat <-----> Sync <-----> PublicOsuBotServer <-----> Osu!

### Config in config.ini
**[PublicOsuBotTransferPlugin.OsuBotTransferClient]** <br/>

Name|Value Type|Default Value|Decription
---|---|---|---
Target_User_Name|string||Your OSU! Username|
AutoReconnect|bool|False|Automatically reconnect after dropping|
AutoReconnectInterval|Integer|10s|Reconnect repeat the retry interval|
ServerPath|string|wss://osubot.kedamaovo.moe|IRC Bot Server URL|


### Notice
In order not to impose a heavy burden on Bancho, Each OSU user can only receive **30 messages per minute**.

### Usage
[Video Tutorial](https://puu.sh/AOACO/056147cb4a.mp4)

### Screenshot
![](https://puu.sh/AMSQs/8a5ae9523c.png)
