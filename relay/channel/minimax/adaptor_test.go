package minimax

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func newImageEditContext(t *testing.T, files map[string][]byte, formValues map[string]string) *gin.Context {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for key, value := range formValues {
		require.NoError(t, writer.WriteField(key, value))
	}
	for name, data := range files {
		part, err := writer.CreateFormFile("image", name)
		require.NoError(t, err)
		_, err = part.Write(data)
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
		map[string][]byte{
			"subject.jpg":                    jpeg,
			"style-reference-preset.webp":    webp,
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
	require.Len(t, payload.SubjectReference, 2)

	wantJPEG := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpeg)
	wantWebP := "data:image/webp;base64," + base64.StdEncoding.EncodeToString(webp)

	var gotJPEG, gotWebP string
	for _, ref := range payload.SubjectReference {
		assert.Equal(t, "character", ref.Type)
		switch ref.ImageFile {
		case wantJPEG:
			gotJPEG = ref.ImageFile
		case wantWebP:
			gotWebP = ref.ImageFile
		default:
			t.Fatalf("unexpected reference image_file: %q", ref.ImageFile)
		}
	}
	assert.Equal(t, wantJPEG, gotJPEG, "jpeg reference missing or wrong")
	assert.Equal(t, wantWebP, gotWebP, "webp reference missing or wrong")
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
