package main

import (
	"time"
)

type User struct {
	UID            int32  `db:"uid"`
	Username       string `db:"username"`
	Banned         int32  `db:"banned"`
	BannedDuration int64  `db:"banned_duration"`
	BannedDate     int64  `db:"banned_date"`
	FirstLoginDate int64  `db:"first_login_date"`
	LastLoginDate  int64  `db:"last_login_date"`
}

func (u *User) GetBannedETA() time.Duration {
	eta := u.BannedDate + u.BannedDuration - now()
	if eta < 0 {
		eta = 0
	}
	return time.Duration(eta) * time.Millisecond
}

func (u *User) Ban(duration time.Duration) {
	u.Banned = 1
	u.BannedDate = now()
	u.BannedDuration = int64(duration / time.Millisecond)
}

func (u *User) Unban() {
	u.Banned = 0
	u.BannedDate = 0
	u.BannedDuration = 0
}

func (u *User) IsBanned() bool {
	return u.Banned == 1
}
