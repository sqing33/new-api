package minimax

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	channelconstant "github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const planExhaustedBody = `{"id":"06f9a053","choices":null,"created":1789554003,"model":"MiniMax-M3",` +
	`"object":"chat.completion","usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0},` +
	`"base_resp":{"status_code":2056,"status_msg":"已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。"}}`

const planExhaustedFrame = "data: " + planExhaustedBody + "\n\n"

func newMiniMaxResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func useShortProbeTimeout(t *testing.T, seconds int) {
	t.Helper()
	original := channelconstant.StreamingTimeout
	channelconstant.StreamingTimeout = seconds
	t.Cleanup(func() { channelconstant.StreamingTimeout = original })
}

// MiniMax answers an exhausted Token Plan with HTTP 200 + base_resp 2056 and a
// null choices array. The shared OpenAI handlers read that as an empty success,
// so the chat path must turn it into an error before the body reaches the client.
func TestDoResponseSurfacesPlanExhaustedStream(t *testing.T) {
	useShortProbeTimeout(t, 5)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	resp := newMiniMaxResponse(planExhaustedFrame)

	usage, newAPIError := (&Adaptor{}).DoResponse(c, resp, &relaycommon.RelayInfo{IsStream: true})

	require.NotNil(t, newAPIError)
	assert.Nil(t, usage)
	assert.Equal(t, http.StatusTooManyRequests, newAPIError.StatusCode)
	assert.Contains(t, newAPIError.Error(), "已达到 Token Plan 用量上限")
	assert.Empty(t, recorder.Body.String(), "the upstream error frame must not be forwarded to the client")
}

func TestDoResponseSurfacesPlanExhaustedBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	resp := newMiniMaxResponse(planExhaustedBody)
	resp.Header.Set("Content-Type", "application/json")

	usage, newAPIError := (&Adaptor{}).DoResponse(c, resp, &relaycommon.RelayInfo{})

	require.NotNil(t, newAPIError)
	assert.Nil(t, usage)
	assert.Equal(t, http.StatusTooManyRequests, newAPIError.StatusCode)
	assert.Contains(t, newAPIError.Error(), "已达到 Token Plan 用量上限")
	assert.Empty(t, recorder.Body.String(), "the upstream error body must not be forwarded to the client")
}

// A healthy stream must reach the shared handler with every byte intact: the
// probe consumes the opening frame and has to replay it.
func TestInspectChatBusinessErrorReplaysHealthyStream(t *testing.T) {
	useShortProbeTimeout(t, 5)

	stream := ": ping\n\n" +
		`data: {"id":"1","choices":[{"delta":{"content":"hel"}}]}` + "\n\n" +
		`data: {"id":"1","choices":[{"delta":{"content":"lo"}}]}` + "\n\n" +
		"data: [DONE]\n\n"
	resp := newMiniMaxResponse(stream)

	require.Nil(t, inspectChatBusinessError(resp, &relaycommon.RelayInfo{IsStream: true}))

	replayed, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, stream, string(replayed))
}

func TestInspectChatBusinessErrorReplaysHealthyBody(t *testing.T) {
	body := `{"id":"1","choices":[{"message":{"content":"hello"}}],"base_resp":{"status_code":0,"status_msg":""}}`
	resp := newMiniMaxResponse(body)
	resp.Header.Set("Content-Type", "application/json")

	require.Nil(t, inspectChatBusinessError(resp, &relaycommon.RelayInfo{}))

	replayed, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, body, string(replayed))
}

func TestInspectChatBusinessErrorStatusMapping(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int64
		want       int
	}{
		{"auth", 1004, http.StatusUnauthorized},
		{"plan exhausted", 2056, http.StatusTooManyRequests},
		{"rate limited", 2062, http.StatusTooManyRequests},
		{"unmapped", 9999, http.StatusBadGateway},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"choices":null,"base_resp":{"status_code":` + strconv.FormatInt(tc.statusCode, 10) +
				`,"status_msg":"boom"}}`
			resp := newMiniMaxResponse(body)
			resp.Header.Set("Content-Type", "application/json")

			newAPIError := inspectChatBusinessError(resp, &relaycommon.RelayInfo{})
			require.NotNil(t, newAPIError)
			assert.Equal(t, tc.want, newAPIError.StatusCode)
			assert.Contains(t, newAPIError.Error(), "boom")
		})
	}
}

// The probe must not hang forever when the upstream never opens the stream.
func TestInspectStreamBusinessErrorTimesOut(t *testing.T) {
	useShortProbeTimeout(t, 1)

	blocking := &blockingBody{release: make(chan struct{}), closed: make(chan struct{})}
	t.Cleanup(func() { blocking.Close() })
	resp := &http.Response{StatusCode: http.StatusOK, Body: blocking}

	start := time.Now()
	newAPIError := inspectChatBusinessError(resp, &relaycommon.RelayInfo{IsStream: true})

	require.NotNil(t, newAPIError)
	assert.Equal(t, http.StatusGatewayTimeout, newAPIError.StatusCode)
	assert.Less(t, time.Since(start), 30*time.Second)
}

type blockingBody struct {
	release chan struct{}
	closed  chan struct{}
	once    sync.Once
}

func (b *blockingBody) Read([]byte) (int, error) {
	select {
	case <-b.release:
		return 0, io.EOF
	case <-b.closed:
		return 0, io.ErrClosedPipe
	}
}

func (b *blockingBody) Close() error {
	b.once.Do(func() { close(b.closed) })
	return nil
}
