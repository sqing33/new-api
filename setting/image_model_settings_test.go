package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestImageModelSpeechCapabilitiesRoundTrip 覆盖语音能力配置的持久化契约：
// tts_modes / asr_modes 必须能通过 option JSON 往返，且只在非空时序列化，
// 避免给未配置语音能力的模型写入空数组。
func TestImageModelSpeechCapabilitiesRoundTrip(t *testing.T) {
	original := ImageModelSettings
	t.Cleanup(func() { ImageModelSettings = original })

	const payload = `[
		{"model":"speech-2.8-turbo","modes":[],"max_n":1,"tts_modes":["speech"]},
		{"model":"asr-1.0","modes":[],"max_n":1,"asr_modes":["transcription"]},
		{"model":"both","modes":[],"max_n":1,"tts_modes":["speech"],"asr_modes":["transcription"]},
		{"model":"plain","modes":["generations"],"max_n":1}
	]`

	require.NoError(t, UpdateImageModelSettingsByJsonString(payload))

	assert.True(t, ImageModelSupportsTTS("speech-2.8-turbo"))
	assert.False(t, ImageModelSupportsASR("speech-2.8-turbo"))

	assert.False(t, ImageModelSupportsTTS("asr-1.0"))
	assert.True(t, ImageModelSupportsASR("asr-1.0"))

	assert.True(t, ImageModelSupportsTTS("both"))
	assert.True(t, ImageModelSupportsASR("both"))

	assert.False(t, ImageModelSupportsTTS("plain"))
	assert.False(t, ImageModelSupportsASR("plain"))

	assert.False(t, ImageModelSupportsTTS("not-configured"))
	assert.False(t, ImageModelSupportsASR("not-configured"))
}

func TestImageModelSpeechCapabilitiesOmitEmptyModes(t *testing.T) {
	original := ImageModelSettings
	t.Cleanup(func() { ImageModelSettings = original })

	require.NoError(t, UpdateImageModelSettingsByJsonString(
		`[{"model":"plain","modes":["generations"],"max_n":1}]`,
	))

	serialized := ImageModelSettings2JsonString()
	assert.NotContains(t, serialized, "tts_modes")
	assert.NotContains(t, serialized, "asr_modes")
}
