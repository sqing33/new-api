package openai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relaykittypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newEmptyOutputTestContext(t *testing.T, body, contentType string, isStream bool) (*gin.Context, *httptest.ResponseRecorder, *http.Response, *relaycommon.RelayInfo) {
	t.Helper()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{contentType}},
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{},
		IsStream:    isStream,
		RelayFormat: relaykittypes.RelayFormatOpenAI,
	}
	return c, recorder, resp, info
}

func useShortStreamingTimeout(t *testing.T, seconds int) {
	t.Helper()
	original := constant.StreamingTimeout
	constant.StreamingTimeout = seconds
	t.Cleanup(func() { constant.StreamingTimeout = original })
}

func setupTestMode(t *testing.T) {
	t.Helper()
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })
}

// 上游返回 200 且流以 done/eof 正常结束，但没有产出任何数据帧：必须转换成
// 可重试的 503 错误，客户端不能收到空成功。
func TestOaiStreamHandlerEmptyStreamBecomesRetryableError(t *testing.T) {
	setupTestMode(t)
	useShortStreamingTimeout(t, 5)

	for _, tc := range []struct {
		name string
		body string
	}{
		{"no frames at all", ""},
		{"only DONE frame", "data: [DONE]\n\n"},
		{"only SSE comments", ": ping\n\n: ping\n\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newEmptyOutputTestContext(t, tc.body, "text/event-stream", true)

			usage, apiErr := OaiStreamHandler(c, info, resp)

			require.Nil(t, usage)
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusServiceUnavailable, apiErr.StatusCode)
			assert.Equal(t, relaykittypes.ErrorCodeBadResponse, apiErr.GetErrorCode())
			assert.Contains(t, apiErr.Error(), "no output content")
			assert.Empty(t, recorder.Body.String(), "client must not receive any bytes for an empty success")
		})
	}
}

// 流里确实有内容帧转发给客户端时，正常成功路径不受影响。
func TestOaiStreamHandlerHealthyStreamUnaffected(t *testing.T) {
	setupTestMode(t)
	useShortStreamingTimeout(t, 5)

	body := strings.Join([]string{
		`data: {"id":"1","choices":[{"delta":{"content":"hel"}}]}`,
		``,
		`data: {"id":"1","choices":[{"delta":{"content":"lo"}}]}`,
		``,
		`data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	c, recorder, resp, info := newEmptyOutputTestContext(t, body, "text/event-stream", true)

	usage, apiErr := OaiStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 2, usage.PromptTokens)
	assert.Equal(t, 2, usage.CompletionTokens)
	assert.Contains(t, recorder.Body.String(), "hel")
	assert.Contains(t, recorder.Body.String(), "lo")
}

// 客户端主动断开时不算空成功，保持原行为（返回局部 usage，不返回错误）。
func TestOaiStreamHandlerClientGoneStaysSuccess(t *testing.T) {
	setupTestMode(t)
	useShortStreamingTimeout(t, 5)

	c, recorder, resp, info := newEmptyOutputTestContext(t, "", "text/event-stream", true)
	ctx, cancel := context.WithCancel(c.Request.Context())
	t.Cleanup(cancel)
	c.Request = c.Request.WithContext(ctx)
	cancel() // 立即取消，模拟客户端已断开

	usage, apiErr := OaiStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	require.NotNil(t, info.StreamStatus)
	assert.Equal(t, relaycommon.StreamEndReasonClientGone, info.StreamStatus.EndReason)
	assert.Empty(t, recorder.Body.String())
}

// 非流式：200 + 无 choices 输出 + completion_tokens=0 → 503 可重试错误。
func TestOpenaiHandlerEmptyResponseBecomesRetryableError(t *testing.T) {
	setupTestMode(t)

	for _, tc := range []struct {
		name string
		body string
	}{
		{"null choices", `{"id":"1","object":"chat.completion","choices":null,"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}`},
		{"empty choices", `{"id":"1","object":"chat.completion","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}`},
		{"choice without content", `{"id":"1","object":"chat.completion","choices":[{"message":{"role":"assistant"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newEmptyOutputTestContext(t, tc.body, "application/json", false)

			usage, apiErr := OpenaiHandler(c, info, resp)

			require.Nil(t, usage)
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusServiceUnavailable, apiErr.StatusCode)
			assert.Equal(t, relaykittypes.ErrorCodeBadResponse, apiErr.GetErrorCode())
			assert.Contains(t, apiErr.Error(), "no output content")
			assert.Empty(t, recorder.Body.String(), "client must not receive any bytes for an empty success")
		})
	}
}

// 非流式：有正常内容或显式 error 信封的响应不受新守卫影响。
func TestOpenaiHandlerHealthyOrErrorResponsesUnaffected(t *testing.T) {
	setupTestMode(t)

	t.Run("healthy content passthrough", func(t *testing.T) {
		body := `{"id":"1","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`
		c, recorder, resp, info := newEmptyOutputTestContext(t, body, "application/json", false)

		usage, apiErr := OpenaiHandler(c, info, resp)

		require.Nil(t, apiErr)
		require.NotNil(t, usage)
		assert.Equal(t, 5, usage.CompletionTokens)
		assert.Contains(t, recorder.Body.String(), "hello")
	})

	t.Run("explicit error envelope still surfaces", func(t *testing.T) {
		body := `{"error":{"message":"boom","type":"server_error"}}`
		c, _, resp, info := newEmptyOutputTestContext(t, body, "application/json", false)

		usage, apiErr := OpenaiHandler(c, info, resp)

		require.Nil(t, usage)
		require.NotNil(t, apiErr)
		assert.Contains(t, apiErr.Error(), "boom")
	})
}

// 只发 tool call 的响应不算空输出。
func TestOpenaiHandlerToolCallOnlyResponseUnaffected(t *testing.T) {
	setupTestMode(t)

	body := `{"id":"1","object":"chat.completion","choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`
	c, _, resp, info := newEmptyOutputTestContext(t, body, "application/json", false)

	usage, apiErr := OpenaiHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 5, usage.CompletionTokens)
}

// 流式最后一个帧只有 usage 没有任何内容时（lastStreamData 非空），不算空流。
func TestOaiStreamHandlerUsageOnlyLastFrameUnaffected(t *testing.T) {
	setupTestMode(t)
	useShortStreamingTimeout(t, 5)

	body := strings.Join([]string{
		`data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}`,
		``,
		`data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	c, recorder, resp, info := newEmptyOutputTestContext(t, body, "text/event-stream", true)

	usage, apiErr := OaiStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 1, usage.CompletionTokens)
	assert.Contains(t, recorder.Body.String(), "hi")
}
