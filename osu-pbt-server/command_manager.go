package main

import (
	"fmt"
	"golang.org/x/crypto/ssh/terminal"
	"io"
	"os"
	"strings"
)

type RegisterCommand struct {
	callback  func(string, []string, io.Writer)
	detail    string
	argsCount int
}

type Command struct {
	From    string
	Command string
	Output  io.Writer
}

type CommandManager struct {
	cmds        map[string]RegisterCommand
	pushCommand chan Command
	oldTerminalState 	*terminal.State
}

func (cm *CommandManager) AddCallback(key string, callback func(string, []string, io.Writer), detail string, argsCount int) {
	cm.cmds[key] = RegisterCommand{
		callback:  callback,
		detail:    detail,
		argsCount: argsCount,
	}
}

func (cm *CommandManager) PushCommand(from string, text string) {
	cm.PushCommandEx(from, text, os.Stdout)
}

func (cm *CommandManager) PushCommandEx(from string, cmd string, o io.Writer) {
	args := strings.Split(cmd, " ")
	if len(args) < 0 {
		return
	}

	if rcmd, exist := cm.cmds[args[0]]; exist {
		if len(args)-1 < rcmd.argsCount {
			fmt.Fprintf(o, "Not enough parameters. (%d/%d)\n\r", len(args)-1, rcmd.argsCount)
			return
		}
		rcmd.callback(from, args[1:], o)
	} else {
		fmt.Fprintf(o, "Command no exist!\n\r")
	}
}

func (cm *CommandManager) ReadStdinPump() {
	cm.oldTerminalState,_ = terminal.MakeRaw(int(os.Stdin.Fd()))


	inTerm := terminal.NewTerminal(os.Stdin,">")

	//reader := bufio.NewReader(os.Stdin)
	for{
		line,err := inTerm.ReadLine()
		strings.Trim(line,"\n")
		if err != nil{
			fmt.Printf("Can't read stdin.\n\r")
			continue
		}
		cm.PushCommand("Server", line)
	}
}

func (cm *CommandManager) QuitStdinPump(){
	terminal.Restore(int(os.Stdin.Fd()),cm.oldTerminalState)
}

func NewCommandManager(addHelp bool) *CommandManager {
	cm := &CommandManager{
		cmds:        make(map[string]RegisterCommand),
		pushCommand: make(chan Command, 64),
	}

	if addHelp {
		cm.AddCallback("help", func(from string, args []string, o io.Writer) {
			for k, v := range cm.cmds {
				fmt.Fprintf(o, "%s\t%s\n\r", k, v.detail)
			}
		}, "\t\t\tShow help", 0)
	}

	return cm
}
