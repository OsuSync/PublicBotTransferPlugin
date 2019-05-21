package main

import (
	"time"
)

type User struct {
	UID            int64  `db:"uid"`
	Username       string `db:"username"`
	Banned         int8   `db:"banned"`
	BannedDuration int64  `db:"banned_duration"`
	BannedDate     int64  `db:"banned_date"`
	FirstLoginDate int64  `db:"first_login_date"`
	LastLoginDate  int64  `db:"last_login_date"`

	// PP
	StdPP   float64 `db:"std_pp"`
	TaikoPP float64 `db:"taiko_pp"`
	CtbPP   float64 `db:"ctb_pp"`
	ManiaPP float64 `db:"mania_pp"`
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

func (u *User) ApplyStdPPFromPpy() {
	if pp, ok := osuAPI.GetUserPP(u.UID, 0); ok {
		u.StdPP = pp
	}
}

func (u *User) ApplyTaikoPPFromPpy() {
	if pp, ok := osuAPI.GetUserPP(u.UID, 1); ok {
		u.TaikoPP = pp
	}
}

func (u *User) ApplyCtbPPFromPpy() {
	if pp, ok := osuAPI.GetUserPP(u.UID, 2); ok {
		u.CtbPP = pp
	}
}

func (u *User) ApplyManiaPPFromPpy() {
	if pp, ok := osuAPI.GetUserPP(u.UID, 3); ok {
		u.ManiaPP = pp
	}
}

func (u *User) ApplyUserPPFromPpy() bool {
	updated := false

	if isLessZerof(u.StdPP) {
		u.ApplyStdPPFromPpy()
		updated = true
	}
	if isLessZerof(u.TaikoPP) {
		u.ApplyTaikoPPFromPpy()
		updated = true
	}
	if isLessZerof(u.CtbPP) {
		u.ApplyCtbPPFromPpy()
		updated = true
	}
	if isLessZerof(u.ManiaPP) {
		u.ApplyManiaPPFromPpy()
		updated = true
	}

	return updated
}
