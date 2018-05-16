using Sync.Client;
using Sync.Plugins;
using Sync.Tools;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using static Sync.Plugins.PluginEvents;

namespace PublicOsuBotTransfer
{
    public class PublicOsuBotTransferPlugin : Plugin, IConfigurable
    {
        private PluginConfigurationManager config_manager;

        public PublicOsuBotTransferPlugin() : base("PublicOsuBotTransferPlugin", "MikiraSora")
        {

        }

        public override void OnEnable()
        {
            var client= new OsuBotTransferClient();

            config_manager = new PluginConfigurationManager(this);
            config_manager.AddItem(this);
            config_manager.AddItem(client);

            base.EventBus.BindEvent<InitClientEvent>(evt => {
                evt.Clients.AddAllClient(client);
            });
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
