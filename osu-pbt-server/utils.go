package main

func isLessZerof(f float64) bool {
	return f < 0
}

func modeStringToInt(mode string) int {
	switch mode {
	case "Osu":
		return 0
	case "Taiko":
		return 1
	case "CatchTheBeat":
		return 2
	case "Mania":
		return 3
	}
	return -1
}
