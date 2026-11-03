package minimax

import (
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// MiniMaxASRResponse 是 MiniMax /v1/speech_to_text 的非流式 JSON 响应。
// text 字段与 OpenAI /v1/audio/transcriptions 的响应语义一致，可直接透传。
type MiniMaxASRResponse struct {
	Text     string  `json:"text"`
	Duration float64 `json:"duration"`
	TraceID  string  `json:"trace_id"`
}

// handleASRResponse 把 MiniMax 语音识别响应转写成 OpenAI /v1/audio/transcriptions 格式。
//
// MiniMax 的 response_format 取值与 OpenAI 兼容（json / verbose_json / srt / vtt），
// 其中 srt 与 vtt 直接返回纯文本字幕，其余返回 JSON，因此按格式分流透传。
func handleASRResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("failed to read minimax ASR response: %w", readErr),
			types.ErrorCodeReadResponseBodyFailed,
			http.StatusInternalServerError,
		)
	}

	responseFormat := c.GetString(asrRequestedFormatKey)

	// srt / vtt 是字幕纯文本，没有 JSON 结构可解析，也无法据此计费，
	// 按 OpenAI 语义原样返回字幕内容。
	if responseFormat == asrFormatSRT || responseFormat == asrFormatVTT {
		c.Data(resp.StatusCode, subtitleContentType(responseFormat), body)
		return &dto.Usage{
			PromptTokens:     info.GetEstimatePromptTokens(),
			CompletionTokens: 0,
			TotalTokens:      info.GetEstimatePromptTokens(),
		}, nil
	}

	var asrResp MiniMaxASRResponse
	if unmarshalErr := common.Unmarshal(body, &asrResp); unmarshalErr != nil {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("failed to unmarshal minimax ASR response: %w", unmarshalErr),
			types.ErrorCodeBadResponseBody,
			http.StatusInternalServerError,
		)
	}

	// MiniMax 的 text / segments 字段布局与 OpenAI 兼容，直接透传原始 body，
	// 保留 verbose_json 下的说话人分离与逐句时间戳等扩展信息。
	service.IOCopyBytesGracefully(c, resp, body)

	return service.ResponseText2Usage(c, asrResp.Text, info.UpstreamModelName, info.GetEstimatePromptTokens()), nil
}

func subtitleContentType(responseFormat string) string {
	if responseFormat == asrFormatVTT {
		return "text/vtt"
	}
	return "text/plain"
}
