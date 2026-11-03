package minimax

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLForImageGeneration(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: "https://api.minimax.chat",
		},
	}

	got, err := GetRequestURL(info)
	if err != nil {
		t.Fatalf("GetRequestURL returned error: %v", err)
	}

	want := "https://api.minimax.chat/v1/image_generation"
	if got != want {
		t.Fatalf("GetRequestURL() = %q, want %q", got, want)
	}
}

func TestConvertImageRequest(t *testing.T) {
	t.Parallel()

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeImagesGenerations,
		OriginModelName: "image-01",
	}
	request := dto.ImageRequest{
		Model:          "image-01",
		Prompt:         "a red fox in snowfall",
		Size:           "1536x1024",
		ResponseFormat: "url",
		N:              uintPtr(2),
	}

	got, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	if err != nil {
		t.Fatalf("ConvertImageRequest returned error: %v", err)
	}

	body, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}

	if payload["model"] != "image-01" {
		t.Fatalf("model = %#v, want %q", payload["model"], "image-01")
	}
	if payload["prompt"] != request.Prompt {
		t.Fatalf("prompt = %#v, want %q", payload["prompt"], request.Prompt)
	}
	if payload["n"] != float64(2) {
		t.Fatalf("n = %#v, want 2", payload["n"])
	}
	if payload["aspect_ratio"] != "3:2" {
		t.Fatalf("aspect_ratio = %#v, want %q", payload["aspect_ratio"], "3:2")
	}
	if payload["response_format"] != "url" {
		t.Fatalf("response_format = %#v, want %q", payload["response_format"], "url")
	}
}

func TestDoResponseForImageGeneration(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations,
		StartTime: time.Unix(1700000000, 0),
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       httptest.NewRecorder().Result().Body,
	}
	resp.Body = ioNopCloser(`{"data":{"image_urls":["https://example.com/minimax.png"]}}`)

	adaptor := &Adaptor{}
	usage, err := adaptor.DoResponse(c, resp, info)
	if err != nil {
		t.Fatalf("DoResponse returned error: %v", err)
	}
	if usage == nil {
		t.Fatalf("DoResponse returned nil usage")
	}

	body := recorder.Body.String()
	if !strings.Contains(body, `"url":"https://example.com/minimax.png"`) {
		t.Fatalf("response body = %s, want OpenAI image response with image URL", body)
	}
	if strings.Contains(body, `"image_urls"`) {
		t.Fatalf("response body = %s, should not expose raw MiniMax image_urls payload", body)
	}
}

func TestGetRequestURLForImageEdit(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesEdits,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: "https://api.minimax.chat",
		},
	}

	got, err := GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.minimax.chat/v1/image_generation", got)
}

type editFormFile struct {
	name string
	data []byte
}

func newImageEditContext(t *testing.T, files []editFormFile, formValues map[string]string) *gin.Context {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for key, value := range formValues {
		require.NoError(t, writer.WriteField(key, value))
	}
	for _, f := range files {
		part, err := writer.CreateFormFile("image", f.name)
		require.NoError(t, err)
		_, err = part.Write(f.data)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/pg/images/edits", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	require.NoError(t, req.ParseMultipartForm(32<<20))

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return c
}

func TestConvertImageRequestForImageEdit(t *testing.T) {
	t.Parallel()

	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03}
	webp := []byte{0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50}

	c := newImageEditContext(t,
		[]editFormFile{
			{name: "subject.jpg", data: jpeg},
			{name: "style-reference-preset.webp", data: webp},
		},
		map[string]string{
			"prompt":          "a cute mascot poster",
			"response_format": "b64_json",
		},
	)

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeImagesEdits,
		OriginModelName: "image-01",
	}
	request := dto.ImageRequest{
		Model:  "image-01",
		Prompt: "a cute mascot poster",
		Size:   "1536x1024",
		N:      uintPtr(1),
	}

	got, err := adaptor.ConvertImageRequest(c, info, request)
	require.NoError(t, err)

	payload, ok := got.(MiniMaxImageRequest)
	require.True(t, ok, "expected MiniMaxImageRequest, got %T", got)

	assert.Equal(t, "image-01", payload.Model)
	assert.Equal(t, "3:2", payload.AspectRatio)
	assert.Equal(t, "base64", payload.ResponseFormat)

	// image-01 accepts exactly one subject_reference, so only the first
	// (primary) reference is kept.
	require.Len(t, payload.SubjectReference, 1)
	assert.Equal(t, "character", payload.SubjectReference[0].Type)
	assert.Equal(t, "data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString(jpeg), payload.SubjectReference[0].ImageFile)
}

func TestSetupRequestHeaderForImageEditUsesJSONContentType(t *testing.T) {
	t.Parallel()

	// The inbound edits request is multipart/form-data, but the adapter
	// re-marshals the body to JSON; the outbound Content-Type must be
	// application/json or MiniMax rejects the request.
	c := newImageEditContext(t,
		[]editFormFile{{name: "subject.jpg", data: []byte{0xff, 0xd8, 0xff}}},
		map[string]string{"prompt": "a cute cat"},
	)
	require.Contains(t, c.Request.Header.Get("Content-Type"), "multipart/form-data")

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesEdits,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey: "test-key",
		},
	}

	req := http.Header{}
	require.NoError(t, adaptor.SetupRequestHeader(c, &req, info))
	assert.Equal(t, "application/json", req.Get("Content-Type"))
	assert.Equal(t, "Bearer test-key", req.Get("Authorization"))
}

func TestConvertImageRequestForImageEditWithoutFiles(t *testing.T) {
	t.Parallel()

	c := newImageEditContext(t, nil, map[string]string{"prompt": "no reference"})

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesEdits}
	request := dto.ImageRequest{Model: "image-01", Prompt: "no reference"}

	_, err := adaptor.ConvertImageRequest(c, info, request)
	require.Error(t, err)
}

func TestConvertImageRequestForUnsupportedImageMode(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeEmbeddings}
	request := dto.ImageRequest{Model: "image-01", Prompt: "x"}

	_, err := adaptor.ConvertImageRequest(c, info, request)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported image relay mode")
}

type nopReadCloser struct {
	*strings.Reader
}

func (n nopReadCloser) Close() error {
	return nil
}

func ioNopCloser(body string) nopReadCloser {
	return nopReadCloser{Reader: strings.NewReader(body)}
}

func uintPtr(v uint) *uint {
	return &v
}

// TestConvertAudioSpeechRequestOutputFormat 覆盖 MiniMax TTS 的字段映射契约：
// audio_setting.format 承载 OpenAI 的 response_format（音频编码格式），
// output_format 是 MiniMax 独有的返回方式字段，只接受 hex/url，不能被编码格式污染。
func TestConvertAudioSpeechRequestOutputFormat(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		responseFormat string
		wantFormat     string
	}{
		{name: "wav 编码格式不应写入 output_format", responseFormat: "wav", wantFormat: "wav"},
		{name: "mp3 编码格式不应写入 output_format", responseFormat: "mp3", wantFormat: "mp3"},
		{name: "空 response_format 回退默认 mp3", responseFormat: "", wantFormat: defaultTTSAudioFormat},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			adaptor := &Adaptor{}
			info := &relaycommon.RelayInfo{
				RelayMode:       relayconstant.RelayModeAudioSpeech,
				OriginModelName: "speech-2.8-turbo",
				ChannelMeta:     &relaycommon.ChannelMeta{},
			}
			request := dto.AudioRequest{
				Model:          "speech-2.8-turbo",
				Input:          "hello",
				Voice:          "male-qn-qingse",
				ResponseFormat: tc.responseFormat,
			}

			reader, err := adaptor.ConvertAudioRequest(c, info, request)
			require.NoError(t, err)

			body, err := io.ReadAll(reader)
			require.NoError(t, err)

			var got MiniMaxTTSRequest
			require.NoError(t, common.Unmarshal(body, &got))

			require.NotNil(t, got.AudioSetting)
			assert.Equal(t, tc.wantFormat, got.AudioSetting.Format)
			// output_format 必须是合法的 hex，否则 MiniMax 返回 2013 invalid params。
			assert.Equal(t, ttsOutputFormatHex, got.OutputFormat)
			assert.Equal(t, "speech-2.8-turbo", got.Model)
			assert.Equal(t, "hello", got.Text)
			assert.Equal(t, "male-qn-qingse", got.VoiceSetting.VoiceID)
		})
	}
}

func TestConvertAudioRequestForUnsupportedAudioMode(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeEmbeddings}

	_, err := adaptor.ConvertAudioRequest(c, info, dto.AudioRequest{Model: "x"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported audio relay mode")
}

func TestGetRequestURLForAudioEndpoints(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		relayMode int
		want      string
	}{
		{name: "tts", relayMode: relayconstant.RelayModeAudioSpeech, want: "https://api.minimax.cn/v1/t2a_v2"},
		{name: "asr", relayMode: relayconstant.RelayModeAudioTranscription, want: "https://api.minimax.cn/v1/speech_to_text"},
		{name: "asr translation", relayMode: relayconstant.RelayModeAudioTranslation, want: "https://api.minimax.cn/v1/speech_to_text"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			info := &relaycommon.RelayInfo{
				RelayMode:   tc.relayMode,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.minimax.cn"},
			}

			got, err := GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// TestHandleASRResponseSubtitlePassthrough 验证字幕格式按纯文本透传且带正确 Content-Type。
func TestHandleASRResponseSubtitlePassthrough(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		responseFormat  string
		wantContentType string
	}{
		{name: "srt", responseFormat: asrFormatSRT, wantContentType: "text/plain"},
		{name: "vtt", responseFormat: asrFormatVTT, wantContentType: "text/vtt"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set(asrRequestedFormatKey, tc.responseFormat)

			subtitle := "1\n00:00:00,100 --> 00:00:01,660\nhello\n"
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{},
				Body:       ioNopCloser(subtitle),
			}
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}

			usage, apiErr := handleASRResponse(c, resp, info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, subtitle, recorder.Body.String())
			assert.Equal(t, tc.wantContentType, recorder.Header().Get("Content-Type"))
		})
	}
}
