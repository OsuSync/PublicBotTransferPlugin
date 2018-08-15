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
using WebSocketSharp;

namespace PublicOsuBotTransfer
{
    public class OsuBotTransferClient : DefaultClient, IConfigurable
    {
        private const string CONST_ACTION_FLAG = "\x0001ACTION ";
        private const string CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
        private const string CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
        private const int CONST_HEART_CHECK_INTERVAL = 10;

        public static ConfigurationElement ServerPath { get; set; } =  @"ws://mikirasora.moe/osu_bot";
        public static ConfigurationElement Target_User_Name { get; set; } = "";
        public static ConfigurationElement API_Key { get; set; } = "";

        private bool is_connected = false;

        private WebSocket web_socket;
        private Timer heart_check_timer;
        private Thread hear_check_failed_thread;

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

            if (string.IsNullOrWhiteSpace(API_Key))
            {
                IO.CurrentIO.WriteColor($"[OsuBotTransferClient]未钦定配置选项API_Key，请去http://mikirasora.moe/account/api获取Api key并去config.ini填写.", ConsoleColor.Red);
                return;
            }

            if (string.IsNullOrWhiteSpace(Target_User_Name))
            {
                IO.CurrentIO.WriteColor($"[OsuBotTransferClient]未钦定配置选项Target_User_Name，请去config.ini配置.", ConsoleColor.Red);
                return;
            }

            web_socket = new WebSocket(ServerPath);
            web_socket.OnClose += Web_socket_OnClose;
            web_socket.OnError += Web_socket_OnError;
            web_socket.OnMessage += Web_socket_OnMessage;
            web_socket.OnOpen += Web_socket_OnConnected;

            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("api_key", API_Key));
            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("transfer_target_name", Target_User_Name));

            NickName = Target_User_Name;

            web_socket.ConnectAsync();
            heart_check_timer=new Timer((_)=>SendHeartCheck(),null,
                TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL),
                TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL));
        }

        private void SendHeartCheck()
        {
            web_socket.Send(CONST_HEART_CHECK_FLAG);

            hear_check_failed_thread =new Thread(() =>
            {
                Thread.Sleep(TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL));
                StopWork();
            });
        } 

        private void Web_socket_OnConnected(object sender, EventArgs e)
        {
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]成功连接,Enjoy", ConsoleColor.Green);
            SendMessage(new IRCMessage(Target_User_Name.ToString(), $"[OsuBotTransferClient]成功连接,Enjoy"));
            is_connected = true;
        }

        private void Web_socket_OnMessage(object sender, MessageEventArgs e)
        {
            if (e.Data == CONST_HEART_CHECK_OK_FLAG)
            {
                hear_check_failed_thread.Abort();
                return;
            }

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
            heart_check_timer.Dispose();
            heart_check_timer = null;
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
