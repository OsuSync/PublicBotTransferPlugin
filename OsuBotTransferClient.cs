using Sync.Client;
using Sync.MessageFilter;
using Sync.Source;
using Sync.Tools;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using WebSocketSharp;

namespace PublicOsuBotTransfer
{
    public class OsuBotTransferClient : DefaultClient, IConfigurable
    {
        private const string CONST_ACTION_FLAG = "\x0001ACTION ";
        private const string CONNECT_PATH = @"ws://mikirasora.moe/osu_bot";

        public static ConfigurationElement Target_User_Name { get; set; } = "";
        public static ConfigurationElement API_Key { get; set; } = "";

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

        public override void StartWork()
        {
            if (web_socket != null)
                return;

            web_socket = new WebSocket(CONNECT_PATH);
            web_socket.OnClose += Web_socket_OnClose;
            web_socket.OnError += Web_socket_OnError;
            web_socket.OnMessage += Web_socket_OnMessage;
            web_socket.OnOpen += Web_socket_OnConnected;

            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("api_key", API_Key));
            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("transfer_target_name", Target_User_Name));

            NickName = Target_User_Name;

            web_socket.ConnectAsync();
        }

        private void Web_socket_OnConnected(object sender, EventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]成功连接,Enjoy", ConsoleColor.Green);
            SendMessage(new IRCMessage(Target_User_Name.ToString(), $"[OsuBotTransferClient]成功连接,Enjoy"));
            is_connected = true;
        }

        private void Web_socket_OnMessage(object sender, MessageEventArgs e)
        {
            string nick = Target_User_Name;
            string rawmsg = e.Data;

            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]{e.Data}", ConsoleColor.Cyan);
            Sync.SyncHost.Instance.Messages.RaiseMessage<ISourceClient>(new DanmakuMessage() {
                User = nick,
                Message=rawmsg
            });
        }

        private void Web_socket_OnError(object sender, ErrorEventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]{e.Message}",ConsoleColor.Red);
            is_connected = false;
        }

        private void Web_socket_OnClose(object sender, CloseEventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]关闭连接", ConsoleColor.Green);
            is_connected = false;
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
            catch {}
            finally
            {
                web_socket = null;
            }
        }

        public override void SwitchOtherClient()
        {
            StopWork();
        }

        public override void SwitchThisClient()
        {
            StartWork();
        }
    }
}
