using Sync.Client;
using Sync.Command;
using Sync.Plugins;
using Sync.Tools;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using PublicOsuBotTransfer.Gui;
using static Sync.Plugins.PluginEvents;

namespace PublicOsuBotTransfer
{
    public class PublicOsuBotTransferPlugin : Plugin, IConfigurable
    {
        private PluginConfigurationManager config_manager;
        OsuBotTransferClient client = new OsuBotTransferClient();
        public const string VERSION = "1.3.0";
        public string Token => client.Token;
        public string Username => OsuBotTransferClient.Target_User_Name;

        string temp_user_name;

        public PublicOsuBotTransferPlugin() : base("PublicOsuBotTransferPlugin", "MikiraSora && KedamaOvO")
        {
            config_manager = new PluginConfigurationManager(this);
            config_manager.AddItem(client);

            EventBus.BindEvent<InitClientEvent>(evt => {
                evt.Clients.AddAllClient(client);
            });

            EventBus.BindEvent<LoadCompleteEvent>(OnLoaded);
            EventBus.BindEvent<InitCommandEvent>(e=> e.Commands.Dispatch.bind("osu_bot",OnCommand, "PublicOsuBotTransferPlugin"));
        }

        private bool OnCommand(Arguments arg)
        {
            switch (arg.FirstOrDefault()??string.Empty)
            {
                case "auto":
                    if (!string.IsNullOrWhiteSpace(temp_user_name))
                        OsuBotTransferClient.Target_User_Name = temp_user_name;
                    break;
                case "name":
                    if (arg.Count == 1)
                    {
                        IO.CurrentIO.WriteColor("[PublicOsuBotTransferPlugin]please append your user name.for example :\"osu_bot name MikiraSora\"", ConsoleColor.Red);
                        return false;
                    }
                    else
                    {
                        var user_name = string.Join(" ", arg.Skip(1));
                        OsuBotTransferClient.Target_User_Name = user_name;
                    }
                    break;
                default:
                    IO.CurrentIO.WriteColor("[PublicOsuBotTransferPlugin]\nosu_bot auto\t:Automatic to set Target_User_Name up by your osu config files.\n" +
                        "osu_bot name \"your_user_name\"\t:set Target_User_Name explicitly", ConsoleColor.Green);
                    return true;
            }

            IO.CurrentIO.WriteColor($"[PublicOsuBotTransferPlugin]Now Target_User_Name is \"{OsuBotTransferClient.Target_User_Name}\"", ConsoleColor.Green);
            return true;
        }

        private void OnLoaded(LoadCompleteEvent e)
        {
            if (string.IsNullOrWhiteSpace(OsuBotTransferClient.Target_User_Name))
            {
                //尝试给用户提示
                if (TryGetUserName(out var user_name)&&!string.IsNullOrWhiteSpace(user_name))
                {
                    temp_user_name = user_name;
                    IO.CurrentIO.WriteColor($"[PublicOsuBotTransferPlugin]Are you \"{user_name}\"? Current PublicOsuBotTransferPlugin's option Target_User_Name isn't set." +
                        $"You can type 'osu_bot auto' to set up automatically.\nor you can type 'osu_bot name \"your_user_name\" ' to set name up explicitly",ConsoleColor.Yellow);
                }
            }
        }

        public static bool TryGetUserName(out string user_name)
        {
            user_name = "";
            try
            {
                var processes = Process.GetProcessesByName(@"osu!");

                if (processes.Length != 0)
                {
                    string osu_path = processes[0].MainModule.FileName.Replace(@"osu!.exe", string.Empty);

                    string osu_config_file = Path.Combine(osu_path, $"osu!.{Environment.UserName}.cfg");
                    var lines = File.ReadLines(osu_config_file);
                    foreach (var line in lines)
                    {
                        if (line.StartsWith("Username"))
                        {
                            user_name = line.Split('=')[1].Trim();
                        }
                    }
                }
            }
            catch (Exception e)
            {
                IO.CurrentIO.WriteColor("[PublicOsuBotTransferPlugin]Failed to get user name from osu! config files :" + e.Message,ConsoleColor.Yellow);
            }

            return !string.IsNullOrWhiteSpace(user_name);
        }

        public override void OnEnable()
        {
            Plugin guiPlugin = getHoster().EnumPluings().FirstOrDefault(p => p.Name == "ConfigGUI");
            if (guiPlugin != null)
            {
                GuiRegisterHelper.RegisterCustomItem(guiPlugin, client);
            }
        }

        public void onConfigurationLoad()
        {
        }

        public void onConfigurationReload()
        {
        }

        public void onConfigurationSave()
        {
        }
    }
}
