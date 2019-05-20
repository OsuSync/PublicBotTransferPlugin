package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"strconv"
)

const APIHost = "https://osu.ppy.sh"

type OsuApi struct {
	apiKey string
}

func (api *OsuApi) GetUidByUsername(name string) (int32, bool) {
	var url = fmt.Sprintf("%s/api/get_user?k=%s&u=%s&mode=string", APIHost, api.apiKey, name)

	resp, err := http.Get(url)
	if err != nil {
		return 0, false
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)

	if err != nil {
		return 0, false
	}

	var u []map[string]interface{}
	if err = json.Unmarshal(body, &u); err != nil {
		return 0, false
	}

	if len(u) < 1 {
		return 0, false
	}

	uid, err := strconv.ParseInt(u[0]["user_id"].(string), 10, 32)
	if err != nil {
		return 0, false
	}

	return int32(uid), true
}

func NewOsuAPI(apiKey string) *OsuApi {
	return &OsuApi{
		apiKey: apiKey,
	}
}
