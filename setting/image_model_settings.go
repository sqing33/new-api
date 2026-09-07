package setting

import (
	"github.com/QuantumNous/new-api/common"
)

type ImageModelSetting struct {
	Model string   `json:"model"`
	Label string   `json:"label"`
	Modes []string `json:"modes"`
	MaxN  int      `json:"max_n"`
	// SingleEndpoint 表示该模型只暴露一个图像生成接口：图生图（edits）
	// 请求不再映射到独立的编辑端点，而是由适配器合并进文生图请求。
	SingleEndpoint bool                       `json:"single_endpoint,omitempty"`
	VideoModes     []string                   `json:"video_modes,omitempty"`
	Video          *VideoModelSetting         `json:"video,omitempty"`
	Params         map[string]bool            `json:"params,omitempty"`
	Options        map[string][]string        `json:"options,omitempty"`
	Extra          map[string]map[string]bool `json:"extra,omitempty"`
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

// ImageModelUsesSingleEndpoint reports whether the model is configured with a
// single upstream image endpoint, so edits requests must be merged into the
// text-to-image path instead of hitting a separate edit endpoint.
func ImageModelUsesSingleEndpoint(modelName string) bool {
	for i := range ImageModelSettings {
		if ImageModelSettings[i].Model == modelName {
			return ImageModelSettings[i].SingleEndpoint
		}
	}
	return false
}

func ImageModelSettings2JsonString() string {
	jsonBytes, err := common.Marshal(ImageModelSettings)
	if err != nil {
		common.SysLog("error marshalling image model settings: " + err.Error())
		return "[]"
	}
	return string(jsonBytes)
}
