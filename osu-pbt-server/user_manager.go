package main

import (
	"os"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
)

const dbFile = "users.db"

const schema = `CREATE TABLE Users 
(uid INTEGER INTEGER NOT NULL,
 username TEXT COLLATE NOCASE,
 banned INTEGER NOT NULL,
 banned_duration INTEGER NOT NULL,
 banned_date INTEGER NOT NULL,
 first_login_date INTEGER NOT NULL,
 last_login_date INTEGER NOT NULL,
 std_pp REAL NOT NULL,
 taiko_pp REAL NOT NULL,
 ctb_pp REAL NOT NULL,
 mania_pp REAL NOT NULL,
 PRIMARY KEY(uid)
);
 `
const createIndexSchema = `CREATE INDEX username_index
 ON Users (username);`

type UserManager struct {
	db *sqlx.DB
}

func (um *UserManager) Add(user *User) {
	const insertUserSQL = `INSERT INTO Users VALUES(
		$0,
		$1,
		0,
		0,
		0,
		$2,
		$3,

		-1.0,
		-1.0,
		-1.0,
		-1.0)`

	if _, err := um.db.Exec(insertUserSQL, user.UID, user.Username, user.FirstLoginDate, user.FirstLoginDate); err != nil {
		log.Errorf("Database Exception. Can't add user {uid: %d, username: %s}. (%s)", user.UID, user.Username, err)
	}
}

func (um *UserManager) ExistByUID(uid int64) bool {
	const existSQL = `SELECT COUNT(*) FROM Users 
						WHERE uid = $0`
	count := 0
	if err := um.db.Get(&count, existSQL, uid); err != nil {
		log.Errorf("Database Exception. Unable to determine the user {uid: %d} exists . (%s)", uid, err)
	}

	return count != 0
}

func (um *UserManager) ExistByUsername(username string) bool {
	const existSQL = `SELECT COUNT(*) FROM Users 
						WHERE username = $0`
	count := 0
	if err := um.db.Get(&count, existSQL, username); err != nil {
		log.Errorf("Database Exception. Unable to determine the user {username: %s} exists . (%s)", username, err)
	}

	return count != 0
}

func (um *UserManager) GetUIDByUsername(username string) int64 {
	const un2uidSQL = `SELECT uid FROM Users 
							WHERE username = $0`
	uid := int64(0)
	if err := um.db.Get(&uid, un2uidSQL, username); err != nil {
		log.Errorf("Database Exception. Unable to determine the user {username: %s} exists. (%s)", username, err)
	}

	return uid
}

func processUser(u *User) {
	u.LastLoginDate = now()

	if now() > u.BannedDate+u.BannedDuration {
		u.Banned = 0
		u.BannedDuration = 0
		u.BannedDate = 0
	}
}

func (um *UserManager) GetUserByUID(uid int64) (*User, bool) {
	const getSQL = `SELECT * FROM Users WHERE uid = $0`
	user := User{}
	if err := um.db.Get(&user, getSQL, uid); err != nil {
		return nil, false
	}

	processUser(&user)
	um.Update(&user)
	return &user, true
}

func (um *UserManager) GetUserByUsername(username string) (*User, bool) {
	const getSQL = `SELECT * FROM Users WHERE username = $0`
	user := User{}
	if err := um.db.Get(&user, getSQL, username); err != nil {
		return nil, false
	}

	processUser(&user)
	um.Update(&user)
	return &user, true
}

func (um *UserManager) Update(user *User) {
	const updateSQL = `UPDATE Users SET
						   username = $0,
						   banned = $1,
						   banned_duration = $2,
						   banned_date = $3,
						   last_login_date = $4,

						   std_pp = $5,
						   taiko_pp = $6,
						   ctb_pp = $7,
						   mania_pp = $8
					   WHERE
						   uid = $9`
	if _, err := um.db.Exec(updateSQL, 
		user.Username, 
		user.Banned, 
		user.BannedDuration,
		user.BannedDate, 
		user.LastLoginDate, 

		user.StdPP,
		user.TaikoPP,
		user.CtbPP,
		user.ManiaPP,

		user.UID); err != nil {
		log.Errorf("Database Exception. Can't update user {uid: %d ,username: %s}. (%s)", user.UID, user.Username, err)
	}
}

func now() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}

func toMs(d time.Duration) int64 {
	return d.Nanoseconds() / int64(time.Millisecond)
}

func NewUserManager() *UserManager {
	_, err := os.Stat(dbFile)
	dbNotExist := os.IsNotExist(err)

	db, err := sqlx.Connect("sqlite3", dbFile)
	if err != nil {
		log.Fatal(err)
	}

	//if users.db not exist, craete it.
	if dbNotExist {
		tx := db.MustBegin()
		tx.MustExec(schema)
		tx.MustExec(createIndexSchema)
		tx.Commit()
	}

	userManager := &UserManager{
		db: db,
	}

	return userManager
}
