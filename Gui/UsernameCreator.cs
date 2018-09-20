using ConfigGUI.ConfigurationRegion.ConfigurationItemCreators;
using Sync.Tools.ConfigurationAttribute;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PublicOsuBotTransfer.Gui
{
    class UsernameCreator: StringConfigurationItemCreator
    {
        public override Panel CreateControl(BaseConfigurationAttribute attr, PropertyInfo prop, object configuration_instance)
        {
            var panel = base.CreateControl(attr, prop, configuration_instance);
            var textbox = panel.Children[1] as TextBox;

            textbox.Width -= 50;
            Button btn = new Button()
            {
                Content = "Try Get Username",
                Margin = new Thickness(1)
            };

            btn.Click += (s, e) =>
            {
                if (PublicOsuBotTransferPlugin.TryGetUserName(out var username))
                {
                    textbox.Text = username;
                }
                else
                {
                    MessageBox.Show("Can't get username.");
                }
            };

            panel.Children.Add(btn);

            return panel;
        }
    }
}
