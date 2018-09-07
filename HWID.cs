/*
* Copyright (c) 2017 Sebastian Schmidt
* Copyrights licensed under the MIT license.
* See the accompanying LICENSE file for terms.
* from: https://github.com/seb5594/HWID-Builder
*/

using System;
using System.Collections.Generic;
using System.Linq;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace PublicOsuBotTransfer
{
    class HWID
    {
        public string BIOS { get; }
        public string CPU { get; }
        public string HDD { get; }
        public string GPU { get; }
        public string MAC { get; }
        public string OS { get; }

        public string HardwareID { get; }

        public HWID()
        {
            BIOS = GetWMIIdent("Win32_BIOS", "Manufacturer", "SMBIOSBIOSVersion", "IdentificationCode");
            CPU = GetWMIIdent("Win32_Processor", "ProcessorId", "UniqueId", "Name");
            HDD = GetWMIIdent("Win32_DiskDrive", "Model", "TotalHeads");
            GPU = GetWMIIdent("Win32_VideoController", "DriverVersion", "Name");
            OS = GetWMIIdent("Win32_OperatingSystem", "SerialNumber", "Name");

            MAC = GetMACAddress();

            HardwareID = Build();
        }

        private string Build()
        {
            var tmp = string.Concat(BIOS, CPU, HDD, GPU);

            if (tmp == null)
                Console.WriteLine("Could not resolve hardware informations...");

            return Convert.ToBase64String(new System.Security.Cryptography.SHA1CryptoServiceProvider().ComputeHash(Encoding.UTF8.GetBytes(tmp)));
        }

        public string GetMACAddress()
        {
            NetworkInterface[] nics = NetworkInterface.GetAllNetworkInterfaces();
            String sMacAddress = string.Empty;
            foreach (NetworkInterface adapter in nics)
            {
                if (sMacAddress == String.Empty)// only return MAC Address from first card  
                {
                    IPInterfaceProperties properties = adapter.GetIPProperties();
                    sMacAddress = adapter.GetPhysicalAddress().ToString();
                }
            }
            return sMacAddress;
        }

        public override string ToString()
            => string.Format("BIOS\t\t - \t{0}\nCPU\t\t - \t{1}\nGPU\t\t - \t{2}\nMAC\t\t - \t{3}\nOS\t\t - \t{4}\n" + "\nGenerated Hardware ID:\n{6}\n", BIOS, CPU, GPU, MAC, OS, HardwareID);

        private static string GetWMIIdent(string Class, string Property)
        {
            var ident = "";
            var objCol = new ManagementClass(Class).GetInstances();
            foreach (var obj in objCol)
            {
                if ((ident = obj.GetPropertyValue(Property) as string) != "")
                    break;
            }
            return ident;
        }

        private static string GetWMIIdent(string Class, params string[] Propertys)
        {
            var ident = "";
            Array.ForEach(Propertys, prop => ident += GetWMIIdent(Class, prop) + " ");
            return ident;
        }
    }
}
