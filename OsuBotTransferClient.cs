using Sync.Client;
using Sync.MessageFilter;
using Sync.Source;
using Sync.Tools;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using PublicOsuBotTransfer.Attribute;
using Sync.Tools.ConfigurationAttribute;
using WebSocketSharp;
using Sync.Plugins;
using System.IO;
using System.Runtime.InteropServices;

namespace PublicOsuBotTransfer
{
    struct WsCommand
    {
        public UInt16 Command;
    }

    enum MessageType
    {
        Command,
        SyncMessage,
    }

    class Message
    {
        public MessageType type;
        public IMessageBase syncMessage;
        public WsCommand wsCommand;
    }

    public class OsuBotTransferClient : DefaultClient, IConfigurable
    {
        Queue<Message> messageBuffer = new Queue<Message>();
        private Task messgaeBufferTimer;
        private bool messgaeBufferTimerQuit = false;

        private const string CONST_SYNC_NOTICE_HEADER = "\x01\x03\x01";
        private const UInt16 REQ_TOKEN = 1;
        private const UInt16 RPL_TOKEN = 2;

        private string _token = "";
        private bool _token_requsted = false;

        public string Token
        {
            private set
            {
                _token = value;
            }
            get
            {
                if (!_token_requsted)
                {
                    RequestToken();
                    _token_requsted = true;
                }
                return _token;
            }
        }

        [Bool]
        public static ConfigurationElement AutoReconnect { get; set; } = "True";

        [Integer(MinValue = 3,MaxValue = 180)]
        public static ConfigurationElement AutoReconnectInterval { get; set; } = "3";

        [ServerUrl]
        public static ConfigurationElement ServerPath { get; set; } = @"wss://osubot.kedamaovo.moe";

        [Username]
        public static ConfigurationElement Target_User_Name { get; set; } = "";

        private WebSocket web_socket;

        public OsuBotTransferClient() : base("MikiraSora", "OsuBotTransferClient")
        {
            messgaeBufferTimer = Task.Run(()=>
            {
                while (!messgaeBufferTimerQuit)
                {
                    if(messageBuffer.Count > 0 && web_socket.IsAlive)
                    {
                        while(messageBuffer.Count > 0)
                        {
                            var msg = messageBuffer.Dequeue();
                            if (msg.type == MessageType.SyncMessage)
                            {
                                SendMessage(msg.syncMessage);
                            }
                            else if (msg.type == MessageType.Command)
                            {
                                SendCommand(msg.wsCommand);
                            }
                            Thread.Sleep(100);
                        }
                    }
                    Thread.Sleep(1000);
                }
            });
            
        }

        public void onConfigurationLoad()
        {

        }

        public void onConfigurationReload()
        {
            Restart();
        }

        public void onConfigurationSave()
        {

        }

        public override void SwitchOtherClient()
        {
            StopWork();
            CurrentStatus = SourceStatus.IDLE;
        }

        public override void SwitchThisClient()
        {
            StartWork();
        }

        public override void Restart()
        {
            StopWork();
            StartWork();
        }

        public override void StartWork()
        {
            if (web_socket != null)
                return;

            if (string.IsNullOrWhiteSpace(Target_User_Name))
            {
                IO.CurrentIO.WriteColor($"[OsuBotTransferClient]Target_User_Name(OSU! Username) is not set，Please set it in 'config.ini', or set through ConfigGUI.", ConsoleColor.Red);
                return;
            }

            web_socket = new WebSocket(ServerPath);

            web_socket.OnClose += Web_socket_OnClose;
            web_socket.OnError += Web_socket_OnError;
            web_socket.OnMessage += Web_socket_OnMessage;
            web_socket.OnOpen += Web_socket_OnConnected;

            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("transfer_target_name", Target_User_Name));
            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("version", PublicOsuBotTransferPlugin.VERSION));

            NickName = Target_User_Name;

            web_socket.ConnectAsync();
        }

        public override void StopWork()
        {
            if (web_socket == null)
                return;
            try
            {
                web_socket.OnClose -= Web_socket_OnClose;
                web_socket.OnError -= Web_socket_OnError;
                web_socket.OnMessage -= Web_socket_OnMessage;
                web_socket.OnOpen -= Web_socket_OnConnected;
                web_socket.Close();
            }
            catch { }
            finally
            {
                web_socket = null;
                CurrentStatus = SourceStatus.USER_DISCONNECTED;
            }
        }

        public override void SendMessage(IMessageBase message)
        {
            if (!web_socket.IsAlive)
            {
                messageBuffer.Enqueue(new Message
                {
                    type = MessageType.SyncMessage,
                    syncMessage = message,
                });
                return;
            }

            web_socket.Send($"{message?.Message}");
        }

        //WebSocket
        private void Web_socket_OnConnected(object sender, EventArgs e)
        {
            CurrentStatus = SourceStatus.CONNECTED_WORKING;
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]Server Connected, Enjoy", ConsoleColor.Green);
            SendMessage(new IRCMessage(Target_User_Name.ToString(), $"[OsuBotTransferClient]Connected Server, Enjoy"));
        }

        private void Web_socket_OnMessage(object sender, MessageEventArgs e)
        {
            string nick = Target_User_Name;

            if (e.IsText)
            {
                string rawmsg = e.Data;

                if (e.Data.StartsWith(CONST_SYNC_NOTICE_HEADER))
                {
                    string notice = e.Data.Substring(CONST_SYNC_NOTICE_HEADER.Length);
                    IO.CurrentIO.WriteColor($"[OsuBotTransferClient][Notice]{notice}", ConsoleColor.Cyan);
                }
                else
                {
                    IO.CurrentIO.WriteColor($"[OsuBotTransferClient]{e.Data}", ConsoleColor.Cyan);
                    Task.Run(() => Sync.SyncHost.Instance.Messages.RaiseMessage<ISourceClient>(new DanmakuMessage()
                    {
                        User = nick,
                        Message = rawmsg
                    }));
                }
            }
            else if (e.IsBinary)
            {
                var data = e.RawData;
                using (var ms = new MemoryStream(data))
                using (var br = new BinaryReader(ms))
                {
                    if(br.ReadUInt16() == RPL_TOKEN)
                    {
                        int len = br.ReadInt32();
                        byte[] token_bytes = br.ReadBytes(len);
                        var token = Encoding.UTF8.GetString(token_bytes);
                        Token = token;
                        Sync.Tools.IO.DefaultIO.WriteColor($"[OsuBotTransferClient] Get Token: {token}", ConsoleColor.Cyan);
                    }
                }
            }
        }

        private void Web_socket_OnError(object sender, WebSocketSharp.ErrorEventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]{e.Message}", ConsoleColor.Red);
        }

        private void Web_socket_OnClose(object sender, CloseEventArgs e)
        {
            if(!string.IsNullOrEmpty(e.Reason))
                IO.CurrentIO.WriteColor($"[OsuBotTransferClient][Server]{e.Reason}",ConsoleColor.Yellow);
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]Disconnected", ConsoleColor.Green);
            CurrentStatus = SourceStatus.REMOTE_DISCONNECTED;

            if (AutoReconnect == "True")
            {
                //restart
                Task.Run(() =>
                {
                    StopWork();
                    Thread.Sleep(int.Parse(AutoReconnectInterval)*1000);
                    StartWork();
                });
            }
        }

        #region Command

        byte[] getBytes<T>(T str) where T : struct
        {
            int size = Marshal.SizeOf(str);
            byte[] arr = new byte[size];

            IntPtr ptr = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(str, ptr, true);
            Marshal.Copy(ptr, arr, 0, size);
            Marshal.FreeHGlobal(ptr);
            return arr;
        }

        void SendCommand(WsCommand cmd)
        {
            web_socket.Send(getBytes(cmd));
        }

        void RequestToken()
        {
            WsCommand cmd = new WsCommand()
            {
                Command = REQ_TOKEN
            };

            if (web_socket.IsAlive)
            {
                messageBuffer.Enqueue(new Message
                {
                    type = MessageType.Command,
                    wsCommand = cmd,
                });
                return;
            }

            SendCommand(cmd);
            //SendMessage(new IRCMessage(Target_User_Name.ToString(), "[OsuBotTransferClient]Sync wants to request other services that the Token uses to access the Bot. Reply \"!assign_token\" to generate and send a token to Sync."));
        }
        #endregion
    }
}
