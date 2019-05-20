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

namespace PublicOsuBotTransfer
{
    public class OsuBotTransferClient : DefaultClient, IConfigurable
    {
        private const string CONST_SYNC_NOTICE_HEADER = "\x01\x03\x01";

        [Bool]
        public static ConfigurationElement AutoReconnect { get; set; } = "False";

        [Integer(MinValue = 10,MaxValue = 180)]
        public static ConfigurationElement AutoReconnectInterval { get; set; } = "10";

        public static ConfigurationElement ServerPath { get; set; } = @"wss://osubot.kedamaovo.moe";

        [Username]
        public static ConfigurationElement Target_User_Name { get; set; } = "";

        private bool is_connected = false;

        private WebSocket web_socket;

        public OsuBotTransferClient() : base("MikiraSora", "OsuBotTransferClient")
        {

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

        public override void Restart()
        {
            StopWork();
            StartWork();
        }

        public override void SendMessage(IMessageBase message)
        {
            if (!is_connected)
                return;

            web_socket.Send($"{message?.Message}");
        }

        public override async void StartWork()
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

            NickName = Target_User_Name;

            web_socket.ConnectAsync();
        }

        private void Web_socket_OnConnected(object sender, EventArgs e)
        {
            CurrentStatus = SourceStatus.CONNECTED_WORKING;
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]Server Connected, Enjoy", ConsoleColor.Green);
            SendMessage(new IRCMessage(Target_User_Name.ToString(), $"[OsuBotTransferClient]Connected Server, Enjoy"));
            is_connected = true;
        }

        private void Web_socket_OnMessage(object sender, MessageEventArgs e)
        {
            string nick = Target_User_Name;
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

        private void Web_socket_OnError(object sender, ErrorEventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]{e.Message}", ConsoleColor.Red);
            is_connected = false;
        }

        private void Web_socket_OnClose(object sender, CloseEventArgs e)
        {
            if(!string.IsNullOrEmpty(e.Reason))
                IO.CurrentIO.WriteColor($"[OsuBotTransferClient][Server]{e.Reason}",ConsoleColor.Yellow);
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]Disconnected", ConsoleColor.Green);
            is_connected = false;
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

        public override void StopWork()
        {
            if (web_socket == null)
                return;
            try
            {
                web_socket.Close();
                web_socket.OnClose -= Web_socket_OnClose;
                web_socket.OnError -= Web_socket_OnError;
                web_socket.OnMessage -= Web_socket_OnMessage;
                web_socket.OnOpen -= Web_socket_OnConnected;
            }
            catch { }
            finally
            {
                web_socket = null;
                CurrentStatus = SourceStatus.USER_DISCONNECTED;
            }
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
    }
}
