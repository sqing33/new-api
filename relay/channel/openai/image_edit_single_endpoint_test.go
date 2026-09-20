package openai

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestConvertImageEditSingleEndpoint verifies that when the model is
// configured with single_endpoint, an edits request is rewritten into a JSON
// generations request that carries the reference image as a base64 data URI
// instead of being forwarded to a separate edit endpoint.
func TestConvertImageEditSingleEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)

	setting.ImageModelSettings = []setting.ImageModelSetting{
		{
			Model:          "single-endpoint-model",
			Modes:          []string{"generations", "edits"},
			MaxN:           1,
			SingleEndpoint: true,
		},
	}
	defer func() {
		setting.ImageModelSettings = []setting.ImageModelSetting{
			{
				Model: "gpt-image-2",
				Label: "GPT Image 2",
				Modes: []string{"generations", "edits"},
				MaxN:  10,
			},
		}
	}()

	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeImagesEdits,
		OriginModelName: "single-endpoint-model",
	}

	t.Run("multipart edits becomes json generations with data uri", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "single-endpoint-model"))
		require.NoError(t, writer.WriteField("prompt", "make it red"))
		require.NoError(t, writer.WriteField("response_format", "b64_json"))
		part, err := writer.CreateFormFile("image", "ref.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("fake image"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		require.NoError(t, c.Request.ParseMultipartForm(32<<20))

		request := dto.ImageRequest{
			Model:  "single-endpoint-model",
			Prompt: "make it red",
		}
		converted, err := (&Adaptor{}).ConvertImageRequest(c, info, request)
		require.NoError(t, err)

		convertedRequest, ok := converted.(dto.ImageRequest)
		require.True(t, ok)
		require.Empty(t, convertedRequest.Image)
		require.Empty(t, convertedRequest.Mask)

		var references []string
		require.NoError(t, common.Unmarshal(convertedRequest.Images, &references))
		require.Len(t, references, 1)
		require.Contains(t, references, "data:image/png;base64,"+base64.StdEncoding.EncodeToString([]byte("fake image")))

		// The recovered response_format must survive the rewrite.
		require.Equal(t, "b64_json", convertedRequest.ResponseFormat)
	})

	t.Run("unconfigured model keeps default edits forwarding", func(t *testing.T) {
		unconfiguredInfo := &relaycommon.RelayInfo{
			RelayMode:       relayconstant.RelayModeImagesEdits,
			OriginModelName: "gpt-image-1",
		}

		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", "make it red"))
		part, err := writer.CreateFormFile("image", "ref.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("fake image"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		require.NoError(t, c.Request.ParseMultipartForm(32<<20))

		request := dto.ImageRequest{
			Model:  "gpt-image-1",
			Prompt: "make it red",
		}
		converted, err := (&Adaptor{}).ConvertImageRequest(c, unconfiguredInfo, request)
		require.NoError(t, err)
		_, ok := converted.(*bytes.Buffer)
		require.True(t, ok, "default behavior must re-serialize multipart for the edit endpoint")
	})
}

// TestGetRequestURLSingleEndpointEdits verifies the URL rewrite for
// single-endpoint models: edits requests hit the generations path.
func TestGetRequestURLSingleEndpointEdits(t *testing.T) {
	gin.SetMode(gin.TestMode)

	setting.ImageModelSettings = []setting.ImageModelSetting{
		{
			Model:          "single-endpoint-model",
			Modes:          []string{"generations", "edits"},
			MaxN:           1,
			SingleEndpoint: true,
		},
	}
	defer func() {
		setting.ImageModelSettings = nil
	}()

	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeImagesEdits,
		OriginModelName: "single-endpoint-model",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:    1,
			ChannelBaseUrl: "https://upstream.example.com",
		},
		RequestURLPath: "/v1/images/edits",
	}

	url, err := (&Adaptor{}).GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://upstream.example.com/v1/images/generations", url)

	info.OriginModelName = "dual-endpoint-model"
	url, err = (&Adaptor{}).GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://upstream.example.com/v1/images/edits", url)
}
