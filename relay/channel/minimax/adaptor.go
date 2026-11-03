package minimax

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	adaptor := claude.Adaptor{}
	return adaptor.ConvertClaudeRequest(c, info, req)
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	switch info.RelayMode {
	case constant.RelayModeAudioSpeech:
		return a.convertTTSSpeechRequest(c, info, request)
	case constant.RelayModeAudioTranscription, constant.RelayModeAudioTranslation:
		// MiniMax /v1/speech_to_text 同样是 multipart/form-data 上传，
		// 字段布局与 OpenAI 兼容（model/file/response_format/stream），
		// 直接复用 OpenAI 适配器的表单重建逻辑。
		c.Set(asrRequestedFormatKey, request.ResponseFormat)
		adaptor := openai.Adaptor{}
		return adaptor.ConvertAudioRequest(c, info, request)
	default:
		return nil, fmt.Errorf("unsupported audio relay mode: %d", info.RelayMode)
	}
}

// convertTTSSpeechRequest 把 OpenAI /v1/audio/speech 请求翻译成 MiniMax /v1/t2a_v2 请求。
func (a *Adaptor) convertTTSSpeechRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	voiceID := request.Voice
	speed := lo.FromPtrOr(request.Speed, 0.0)

	// audio_setting.format 是音频编码格式，与 OpenAI 的 response_format 语义一致。
	audioFormat := request.ResponseFormat
	if audioFormat == "" {
		audioFormat = defaultTTSAudioFormat
	}
	c.Set(ttsRequestedFormatKey, audioFormat)

	minimaxRequest := MiniMaxTTSRequest{
		Model: info.OriginModelName,
		Text:  request.Input,
		VoiceSetting: VoiceSetting{
			VoiceID: voiceID,
			Speed:   speed,
		},
		AudioSetting: &AudioSetting{
			Format: audioFormat,
		},
		// output_format 是 MiniMax 独有的「返回方式」字段（hex 内联 / url 下载链接），
		// OpenAI 协议没有对应概念，不能从 response_format 推导——该字段只接受
		// hex 或 url，填入 mp3/wav 等编码格式会被上游拒绝（2013 invalid params）。
		// 固定为 hex，让响应处理器直接解出音频字节返回客户端。
		OutputFormat: ttsOutputFormatHex,
	}

	// 同步扩展字段的厂商自定义metadata
	if len(request.Metadata) > 0 {
		if err := common.Unmarshal(request.Metadata, &minimaxRequest); err != nil {
			return nil, fmt.Errorf("error unmarshalling metadata to minimax request: %w", err)
		}
	}

	jsonData, err := common.Marshal(minimaxRequest)
	if err != nil {
		return nil, fmt.Errorf("error marshalling minimax request: %w", err)
	}

	return bytes.NewReader(jsonData), nil
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations:
		return oaiImage2MiniMaxImageRequest(request), nil
	case constant.RelayModeImagesEdits:
		return oaiImageEdit2MiniMaxImageRequest(c, request)
	default:
		return nil, fmt.Errorf("unsupported image relay mode: %d", info.RelayMode)
	}
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return GetRequestURL(info)
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	if info.RelayMode == constant.RelayModeImagesGenerations || info.RelayMode == constant.RelayModeImagesEdits {
		// Image requests are always re-marshalled to JSON by this adapter,
		// including edits where the inbound request is multipart/form-data.
		req.Set("Content-Type", "application/json")
	}
	if info.RelayMode == constant.RelayModeAudioTranscription || info.RelayMode == constant.RelayModeAudioTranslation {
		// MiniMax ASR 用 language 请求头指定语种，而 OpenAI 把它放在 multipart 表单里。
		if lang := c.Request.FormValue("language"); lang != "" {
			req.Set("language", lang)
		}
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	if info.RelayMode == constant.RelayModeAudioTranscription || info.RelayMode == constant.RelayModeAudioTranslation {
		return channel.DoFormRequest(a, c, info, requestBody)
	}
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case constant.RelayModeAudioSpeech:
		return handleTTSResponse(c, resp, info)
	case constant.RelayModeAudioTranscription, constant.RelayModeAudioTranslation:
		return handleASRResponse(c, resp, info)
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return miniMaxImageHandler(c, resp, info)
	}
	if newAPIError := inspectChatBusinessError(resp, info); newAPIError != nil {
		return nil, newAPIError
	}

	switch info.RelayFormat {
	case types.RelayFormatClaude:
		adaptor := claude.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	default:
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
