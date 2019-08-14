using ConfigGUI.ConfigurationRegion.ConfigurationItemCreators;
using Sync.Tools.ConfigurationAttribute;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;

namespace PublicOsuBotTransfer.Gui
{
    class SerrverUrlCreator : StringConfigurationItemCreator
    {
        private OsuBotTransferClient _client;

        public SerrverUrlCreator(OsuBotTransferClient client)
        {
            _client = client;
        }

        public override Panel CreateControl(BaseConfigurationAttribute attr, PropertyInfo prop, object configuration_instance)
        {
            var panel = base.CreateControl(attr, prop, configuration_instance);
            var textbox = panel.Children[1] as TextBox;

            textbox.Width -= 50;
            Button btn = new Button()
            {
                Content = "Connect",
                Margin = new Thickness(1)
            };

            btn.Click += (s, e) =>
            {
                _client.Restart();
            };

            panel.Children.Add(btn);

            return panel;
        }
    }
}
