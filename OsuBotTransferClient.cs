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
using Sync.Tools.ConfigurationAttribute;
using WebSocketSharp;
using Sync.Plugins;

namespace PublicOsuBotTransfer
{
    public class OsuBotTransferClient : DefaultClient, IConfigurable
    {
        private const string CONST_ACTION_FLAG = "\x0001ACTION ";
        private const string CONST_HEART_CHECK_FLAG = "\x01\x01HEARTCHECK";
        private const string CONST_HEART_CHECK_OK_FLAG = "\x01\x02HEARTCHECKOK";
        private const string CONST_SYNC_NOTICE_HEADER = "\x01\x03\x01";
        private const int CONST_HEART_CHECK_INTERVAL = 10;

        [Bool]
        public static ConfigurationElement AutoReconnnect { get; set; } = "False";
        public static ConfigurationElement ServerPath { get; set; } = @"wss://osubot.kedamaovo.moe";
        public static ConfigurationElement Target_User_Name { get; set; } = "";
        public static ConfigurationElement API_Key { get; set; } = "";

        private static HWID s_hwid = new HWID();

        private bool is_connected = false;

        private WebSocket web_socket;
        private Timer heart_check_timer;
        private Thread heart_check_failed_thread;

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

            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("transfer_target_name", Target_User_Name));
            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("hwid", s_hwid.HardwareID));
            web_socket.SetCookie(new WebSocketSharp.Net.Cookie("mac", s_hwid.MAC));

            NickName = Target_User_Name;

            web_socket.ConnectAsync();
            heart_check_timer = new Timer((_) => SendHeartCheck(), null,
                TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL),
                TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL));
        }

        private void SendHeartCheck()
        {
            web_socket.Send(CONST_HEART_CHECK_FLAG);

            heart_check_failed_thread = new Thread(() =>
             {
                 Thread.Sleep(TimeSpan.FromSeconds(CONST_HEART_CHECK_INTERVAL));
                 StopWork();
             });
        }

        private void Web_socket_OnConnected(object sender, EventArgs e)
        {
            CurrentStatus = SourceStatus.CONNECTED_WORKING;
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]成功连接,Enjoy", ConsoleColor.Green);
            SendMessage(new IRCMessage(Target_User_Name.ToString(), $"[OsuBotTransferClient]成功连接,Enjoy"));
            is_connected = true;
        }

        private void Web_socket_OnMessage(object sender, MessageEventArgs e)
        {
            if (e.Data == CONST_HEART_CHECK_OK_FLAG)
            {
                heart_check_failed_thread.Abort();
                return;
            }

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
            IO.CurrentIO.WriteColor($"[OsuBotTransferClient]关闭连接", ConsoleColor.Green);
            is_connected = false;
            heart_check_timer?.Dispose();
            heart_check_timer = null;
            CurrentStatus = SourceStatus.REMOTE_DISCONNECTED;

            if (AutoReconnnect == "True")
            {
                //restart
                Task.Run(() =>
                {
                    StopWork();
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
