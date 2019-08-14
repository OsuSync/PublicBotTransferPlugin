using ConfigGUI;
using PublicOsuBotTransfer.Attribute;
using Sync.Plugins;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PublicOsuBotTransfer.Gui
{
    static class GuiRegisterHelper
    {
        public static void RegisterCustomItem(Plugin plugin, OsuBotTransferClient client)
        {
            var gui = plugin as ConfigGuiPlugin;
            gui.ItemFactory.RegisterItemCreator<UsernameAttribute>(new UsernameCreator());
            gui.ItemFactory.RegisterItemCreator<ServerUrlAttribute>(new SerrverUrlCreator(client));
        }
    }
}
