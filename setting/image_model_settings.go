package setting

import (
	"github.com/QuantumNous/new-api/common"
)

type ImageModelSetting struct {
	Model      string                     `json:"model"`
	Label      string                     `json:"label"`
	Modes      []string                   `json:"modes"`
	MaxN       int                        `json:"max_n"`
	VideoModes []string                   `json:"video_modes,omitempty"`
	Video      *VideoModelSetting         `json:"video,omitempty"`
	Params     map[string]bool            `json:"params,omitempty"`
	Options    map[string][]string        `json:"options,omitempty"`
	Extra      map[string]map[string]bool `json:"extra,omitempty"`
}

type VideoModelSetting struct {
	DefaultSeconds string   `json:"default_seconds,omitempty"`
	Durations      []string `json:"durations,omitempty"`
	DefaultSize    string   `json:"default_size,omitempty"`
	Sizes          []string `json:"sizes,omitempty"`
}

var ImageModelSettings = []ImageModelSetting{
	{
		Model: "gpt-image-2",
		Label: "GPT Image 2",
		Modes: []string{"generations", "edits"},
		MaxN:  10,
	},
}

func UpdateImageModelSettingsByJsonString(jsonString string) error {
	var settings []ImageModelSetting
	if err := common.Unmarshal([]byte(jsonString), &settings); err != nil {
		return err
	}
	if settings == nil {
		settings = make([]ImageModelSetting, 0)
	}
	ImageModelSettings = settings
	return nil
}

func ImageModelSettings2JsonString() string {
	jsonBytes, err := common.Marshal(ImageModelSettings)
	if err != nil {
		common.SysLog("error marshalling image model settings: " + err.Error())
		return "[]"
	}
	return string(jsonBytes)
}
