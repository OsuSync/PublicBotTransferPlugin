package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"strconv"
)

const APIHost = "https://osu.ppy.sh"

// OsuAPI is Osu Web Api, https://github.com/ppy/osu-api/wiki
type OsuAPI struct {
	apiKey string
}

func (api *OsuAPI) get(apiname string, parms string) ([]byte, bool) {
	var url = fmt.Sprintf("%s/api/%s?%s&k=%s", APIHost, apiname, parms, api.apiKey)

	resp, err := http.Get(url)
	if err != nil {
		return nil, false
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)

	if err != nil {
		return nil, false
	}

	return body, true
}

func (api *OsuAPI) GetUser(name string, _type string, mode int) (map[string]interface{}, bool) {
	body, ok := api.get("get_user", fmt.Sprintf("u=%s&type=%s&m=%d", name, _type, mode))
	if !ok {
		return nil, false
	}

	var u []map[string]interface{}
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, false
	}

	if len(u) < 1 {
		return nil, false
	}
	return u[0], true
}

func (api *OsuAPI) GetUserRecent(name string, _type string, mode int, limit int) (map[string]interface{}, bool) {
	body, ok := api.get("get_user_recent", fmt.Sprintf("u=%s&type=%s&m=%d&limit=%d", name, _type, mode, limit))
	if !ok {
		return nil, false
	}

	var u []map[string]interface{}
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, false
	}

	if len(u) < 1 {
		return nil, false
	}
	return u[0], true
}

func (api *OsuAPI) GetBeatmap(id int64) (map[string]interface{}, bool) {
	body, ok := api.get("get_beatmaps", fmt.Sprintf("b=%d", id))
	if !ok {
		return nil, false
	}

	var u []map[string]interface{}
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, false
	}

	if len(u) < 1 {
		return nil, false
	}
	return u[0], true
}

func (OsuAPI *OsuAPI) GetUserPP(uid int64, mode int) (float64, bool) {
	//get pp from osu.ppy.sh
	u, ok := OsuAPI.GetUser(fmt.Sprint(uid), "id", mode)
	if !ok {
		return 0.0, false
	}

	if u["pp_raw"] == nil {
		return 0.0, false
	}

	pp, err := strconv.ParseFloat(u["pp_raw"].(string), 64)
	if err != nil {
		return 0.0, false
	}

	return pp, true
}

func NewOsuAPI(apiKey string) *OsuAPI {
	return &OsuAPI{
		apiKey: apiKey,
	}
}
