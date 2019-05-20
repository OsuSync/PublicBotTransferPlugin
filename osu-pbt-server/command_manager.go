package main

import (
	"bufio"
	"fmt"
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

func (cm *CommandManager) PushCommandEx(from string, text string, o io.Writer) {
	cm.pushCommand <- Command{
		From:    from,
		Command: text,
		Output:  o,
	}
}

func (cm *CommandManager) ReadStdinPump() {
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		cm.PushCommand("Server", scanner.Text())
	}
}

func (cm *CommandManager) Run() {
	for {
		cmd := <-cm.pushCommand
		args := strings.Split(cmd.Command, " ")
		if len(args) < 0 {
			continue
		}

		if rcmd, exist := cm.cmds[args[0]]; exist {
			if len(args)-1 < rcmd.argsCount {
				fmt.Fprintf(cmd.Output, "Not enough parameters. (%d/%d)\n", len(args)-1, rcmd.argsCount)
				continue
			}
			rcmd.callback(cmd.From, args[1:], cmd.Output)
		} else {
			fmt.Fprintln(cmd.Output, "Command no exist!")
		}
	}
}

func NewCommandManager(addHelp bool) *CommandManager {
	cm := &CommandManager{
		cmds:        make(map[string]RegisterCommand),
		pushCommand: make(chan Command, 64),
	}

	if addHelp {
		cm.AddCallback("help", func(from string, args []string, o io.Writer) {
			for k, v := range cm.cmds {
				fmt.Fprintf(o, "%s\t%s\n", k, v.detail)
			}
		}, "\t\t\tShow help", 0)
	}

	return cm
}
