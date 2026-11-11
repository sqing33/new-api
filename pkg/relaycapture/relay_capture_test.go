package relaycapture

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestRecorder 构造一个绑定到测试配置的 Recorder，避免依赖全局配置的默认值。
func newTestRecorder(t *testing.T, mutate func(*operation_setting.PayloadCaptureSetting)) *Recorder {
	t.Helper()
	setting := &operation_setting.PayloadCaptureSetting{
		Enabled:                 true,
		CaptureClientRequest:    true,
		CaptureUpstreamRequest:  true,
		CaptureUpstreamResponse: true,
		CaptureBinary:           false,
		MaxPayloadBytes:         operation_setting.DefaultMaxPayloadBytes,
	}
	if mutate != nil {
		mutate(setting)
	}
	return &Recorder{
		setting:   setting,
		limit:     setting.MaxPayloadBytesOrDefault(),
		requestId: "test-request",
		session:   SessionKey{Kind: SessionKeyKindEmpty},
		meta:      RequestMeta{ModelName: "gpt-test", UserId: 1, TokenId: 2},
	}
}

// memoryStorageForTest 返回一个内存 BodyStorage，用于验证采集不会移动其读位置。
func memoryStorageForTest(t *testing.T, payload string) common.BodyStorage {
	t.Helper()
	storage, err := common.CreateBodyStorage(common.StringToByteSlice(payload))
	require.NoError(t, err)
	t.Cleanup(func() { _ = storage.Close() })
	return storage
}

func TestRedactJSONMasksCredentialValues(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		secret string
	}{
		{
			name:   "api_key",
			input:  `{"model":"gpt-test","api_key":"sk-super-secret-value"}`,
			secret: "sk-super-secret-value",
		},
		{
			name:   "nested authorization",
			input:  `{"headers":{"authorization":"Bearer sk-super-secret-value"},"model":"gpt-test"}`,
			secret: "sk-super-secret-value",
		},
		{
			name:   "array element token",
			input:  `{"items":[{"token":"sk-super-secret-value"}]}`,
			secret: "sk-super-secret-value",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := redactJSON(tc.input, false)
			assert.NotContains(t, result.Text, tc.secret, "明文凭据不得出现在脱敏结果中")
			assert.Contains(t, result.Text, maskedValue)
			assert.True(t, result.Redacted, "应标记发生过脱敏")
			// 非敏感字段必须保持原样，避免破坏结构。
			if strings.Contains(tc.input, "gpt-test") {
				assert.Contains(t, result.Text, "gpt-test")
			}
		})
	}
}

func TestRedactJSONKeepsNonSensitiveBodyIntact(t *testing.T) {
	input := `{"model":"gpt-test","messages":[{"role":"user","content":"hello world"}]}`
	result := redactJSON(input, false)
	assert.Equal(t, input, result.Text, "无敏感字段时正文不应被改写")
	assert.False(t, result.Redacted)
}

func TestRedactReplacesBinaryBlocksWhenCaptureBinaryDisabled(t *testing.T) {
	input := `{"messages":[{"role":"user","content":[{"type":"text","text":"describe"},{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]}]}`

	withoutBinary := redactJSON(input, false)
	assert.Contains(t, withoutBinary.Text, "[image omitted]")
	assert.NotContains(t, withoutBinary.Text, "https://example.com/a.png")
	assert.Contains(t, withoutBinary.Text, "describe", "文本部分必须保留")

	withBinary := redactJSON(input, true)
	assert.Contains(t, withBinary.Text, "https://example.com/a.png", "开启二进制采集时应保留原值")
}

func TestRedactReplacesInlineDataURL(t *testing.T) {
	input := `{"image":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="}`
	result := redactJSON(input, false)
	assert.NotContains(t, result.Text, "iVBORw0KGgoAAAANSUhEUg==")
	assert.Contains(t, result.Text, "[binary omitted]")
}

func TestRedactNonJSONMasksFormFields(t *testing.T) {
	input := "model=gpt-test&api_key=sk-super-secret-value&stream=true"
	result := redactNonJSON(input)
	assert.NotContains(t, result, "sk-super-secret-value")
	assert.Contains(t, result, maskedValue)
	assert.Contains(t, result, "model=gpt-test", "非敏感字段必须保留")
	assert.Contains(t, result, "stream=true")
}

func TestBoundedBufferTruncatesAndRecordsOriginalSize(t *testing.T) {
	buffer := newBoundedBuffer(100)
	written, err := buffer.Write(bytes.Repeat([]byte("a"), 500))
	require.NoError(t, err)

	assert.Equal(t, 500, written, "Write 必须报告全部消费字节，否则 io.Copy 会报错")
	assert.Equal(t, 500, buffer.Total(), "应记录原始长度供 UI 展示")
	assert.True(t, buffer.Truncated())

	// 超限时保留 head + tail：内容字节不超过上限（另有中间标记不计入）。
	content := string(buffer.head) + string(buffer.tail)
	assert.LessOrEqual(t, len(content), 100, "内容字节不得超过上限")
	assert.NotEmpty(t, buffer.head, "必须保留开头（system prompt 所在）")
	assert.NotEmpty(t, buffer.tail, "必须保留结尾（最新用户消息所在）")
	assert.Contains(t, buffer.String(), "truncated", "必须显式标注中间被丢弃")
}

func TestBoundedBufferKeepsHeadAndTail(t *testing.T) {
	// 结构化内容：开头是关键指令，结尾是最新提问，中间是大段历史。
	head := `{"model":"gpt-test","messages":[{"role":"system","content":"RULES-MARKER"},`
	tail := `{"role":"user","content":"LATEST-QUESTION-MARKER"}]}`
	middle := strings.Repeat("h", 5000)

	buffer := newBoundedBuffer(400)
	_, err := buffer.Write([]byte(head + middle + tail))
	require.NoError(t, err)

	out := buffer.String()
	assert.Contains(t, out, "RULES-MARKER", "开头必须保留")
	assert.Contains(t, out, "LATEST-QUESTION-MARKER", "结尾必须保留")
	assert.Contains(t, out, "truncated", "中间必须有截断标记")
	assert.NotContains(t, out, strings.Repeat("h", 200), "大段中间内容应被丢弃")
}

func TestCaptureClientRequestDoesNotDisturbStorageCursor(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	payload := `{"model":"gpt-test","messages":[{"role":"user","content":"hi"}]}`
	storage := memoryStorageForTest(t, payload)

	// 采集前把 storage 读到末尾，模拟 relay 已经消费过它。
	_, err := io.ReadAll(storage)
	require.NoError(t, err)

	recorder.CaptureClientRequest(storage)

	// 采集用的是 NewReader() 独立副本，不得移动 storage 自身的读位置之外的状态；
	// 关键在于 relay 仍能重新读到完整原文。
	_, err = storage.Seek(0, io.SeekStart)
	require.NoError(t, err)
	reread, err := io.ReadAll(storage)
	require.NoError(t, err)
	assert.Equal(t, payload, string(reread), "采集后 storage 必须仍可完整重放")

	recorder.mu.Lock()
	captured := recorder.clientRequest
	recorder.mu.Unlock()
	require.NotNil(t, captured)
	assert.Equal(t, payload, captured.String())
}

func TestCaptureClientRequestOnlyOnce(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	first := memoryStorageForTest(t, `{"first":true}`)
	second := memoryStorageForTest(t, `{"second":true}`)

	recorder.CaptureClientRequest(first)
	recorder.CaptureClientRequest(second)

	recorder.mu.Lock()
	captured := recorder.clientRequest.String()
	recorder.mu.Unlock()
	assert.Contains(t, captured, "first")
	assert.NotContains(t, captured, "second", "重试时不应覆盖首次采集的客户端请求体")
}

func TestCaptureUpstreamRequestUsesGetBodyAndLeavesRealBodyIntact(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	recorder.BeginAttempt(0)

	body := `{"model":"gpt-test","messages":[{"role":"user","content":"hi"}]}`
	req, err := http.NewRequest(http.MethodPost, "https://example.com/v1/chat/completions", strings.NewReader(body))
	require.NoError(t, err)
	require.NotNil(t, req.GetBody, "strings.NewReader 会让 http.NewRequest 自动派生 GetBody")

	recorder.CaptureUpstreamRequest(req)

	// 关键不变量：采集绝不能消费真正要发送的 body。
	sent, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	assert.Equal(t, body, string(sent), "上游实际收到的 body 必须与采集前逐字节一致")

	recorder.mu.Lock()
	captured := recorder.upstreamReq
	recorder.mu.Unlock()
	require.NotNil(t, captured)
	assert.Equal(t, body, captured.String())
}

func TestCaptureUpstreamRequestSkipsBodylessRequest(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	recorder.BeginAttempt(0)

	req, err := http.NewRequest(http.MethodGet, "https://example.com/v1/models", nil)
	require.NoError(t, err)
	require.Nil(t, req.GetBody, "bodyless 请求没有 GetBody")

	assert.NotPanics(t, func() { recorder.CaptureUpstreamRequest(req) })

	recorder.mu.Lock()
	captured := recorder.upstreamReq
	recorder.mu.Unlock()
	assert.Nil(t, captured, "bodyless 请求应跳过采集而不是记录空串")
}

func TestStreamFramesAccumulateInOrderAndTruncate(t *testing.T) {
	recorder := newTestRecorder(t, func(s *operation_setting.PayloadCaptureSetting) {
		s.MaxPayloadBytes = 40
	})
	recorder.BeginAttempt(0)

	recorder.CaptureStreamFrame(`{"delta":"a"}`)
	recorder.CaptureStreamFrame(`{"delta":"b"}`)
	// 超限后仍不应报错，只停止累积。
	recorder.CaptureStreamFrame(strings.Repeat("x", 500))

	recorder.mu.Lock()
	buffer := recorder.upstreamResp
	recorder.mu.Unlock()
	require.NotNil(t, buffer)

	text := buffer.String()
	assert.True(t, strings.HasPrefix(text, `{"delta":"a"}`), "开头帧必须保留")
	assert.True(t, buffer.Truncated())
	assert.Contains(t, text, "truncated", "必须显式标注中间被丢弃")
	// 内容字节（head + tail）不超过上限；中间标记是额外的说明文字。
	assert.LessOrEqual(t, len(buffer.head)+len(buffer.tail), 40)
}

func TestStreamFrameSkippedInRawMode(t *testing.T) {
	recorder := newTestRecorder(t, func(s *operation_setting.PayloadCaptureSetting) {
		s.CaptureRawUpstreamResponse = true
	})
	recorder.BeginAttempt(0)

	recorder.CaptureStreamFrame(`{"delta":"a"}`)

	recorder.mu.Lock()
	buffer := recorder.upstreamResp
	recorder.mu.Unlock()
	assert.Nil(t, buffer, "原始字节模式下由 Tee 负责采集，帧回调不应重复累积")
}

func TestWrapResponseBodyPreservesCloseSemantics(t *testing.T) {
	recorder := newTestRecorder(t, func(s *operation_setting.PayloadCaptureSetting) {
		s.CaptureRawUpstreamResponse = true
	})
	recorder.BeginAttempt(0)

	original := &trackingBody{Reader: strings.NewReader(`{"ok":true}`)}
	resp := &http.Response{Body: original}

	recorder.WrapResponseBody(resp)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, `{"ok":true}`, string(body), "Tee 不得改写响应字节")

	require.NoError(t, resp.Body.Close())
	assert.True(t, original.closed, "Close 必须委托给原始 body，否则会破坏上游取消语义")
}

func TestWrapResponseBodySurvivesBodyReplacementByAdaptor(t *testing.T) {
	// 模拟 minimax 的 replayReadCloser：替换 resp.Body 会丢弃 Tee 包装。
	// 这是已知限制，默认的帧回调方案不受影响。
	recorder := newTestRecorder(t, func(s *operation_setting.PayloadCaptureSetting) {
		s.CaptureRawUpstreamResponse = true
	})
	recorder.BeginAttempt(0)

	resp := &http.Response{Body: &trackingBody{Reader: strings.NewReader(`{"first":true}`)}}
	recorder.WrapResponseBody(resp)
	// 渠道实现替换 resp.Body，Tee 随之丢失。
	resp.Body = &trackingBody{Reader: strings.NewReader(`{"replaced":true}`)}

	replaced, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, `{"replaced":true}`, string(replaced))

	// 帧回调方案在此场景下仍能采集，故断言默认路径可用。
	frameRecorder := newTestRecorder(t, nil)
	frameRecorder.BeginAttempt(0)
	frameRecorder.CaptureStreamFrame(`{"replaced":true}`)
	frameRecorder.mu.Lock()
	frameBuffer := frameRecorder.upstreamResp
	frameRecorder.mu.Unlock()
	require.NotNil(t, frameBuffer)
	assert.Contains(t, frameBuffer.String(), "replaced", "默认帧回调方案不受 resp.Body 替换影响")
}

func TestAttemptsAreIsolated(t *testing.T) {
	recorder := newTestRecorder(t, nil)

	recorder.BeginAttempt(0)
	recorder.CaptureStreamFrame("attempt-0")
	first := recorder.snapshotCurrentAttemptLocked()

	recorder.BeginAttempt(1)
	recorder.CaptureStreamFrame("attempt-1")
	second := recorder.snapshotCurrentAttemptLocked()

	require.NotNil(t, first)
	require.NotNil(t, second)
	assert.Equal(t, 0, first.attemptIndex)
	assert.Equal(t, 1, second.attemptIndex)
	assert.Contains(t, first.upstreamResp.String(), "attempt-0")
	assert.NotContains(t, first.upstreamResp.String(), "attempt-1", "attempt 之间不得串数据")
	assert.Contains(t, second.upstreamResp.String(), "attempt-1")
	assert.NotContains(t, second.upstreamResp.String(), "attempt-0")
}

func TestSnapshotToRowMarksPartialAndFailed(t *testing.T) {
	t.Run("failed attempt without response is partial", func(t *testing.T) {
		recorder := newTestRecorder(t, nil)
		recorder.BeginAttempt(0)
		recorder.MarkAttemptFailed()
		recorder.CaptureStreamFrame("") // 无响应帧

		recorder.mu.Lock()
		recorder.upstreamReq = newBoundedBuffer(1024)
		recorder.upstreamReq.Write([]byte(`{"model":"gpt-test"}`))
		snapshot := recorder.snapshotCurrentAttemptLocked()
		recorder.mu.Unlock()

		row := snapshot.toRow()
		assert.Equal(t, StatusPartial, row.CaptureStatus)
		assert.Contains(t, row.UpstreamRequestBody, "gpt-test", "失败 attempt 仍须保留上游请求体")
	})

	t.Run("no content at all is failed", func(t *testing.T) {
		recorder := newTestRecorder(t, nil)
		recorder.BeginAttempt(0)
		recorder.mu.Lock()
		snapshot := recorder.snapshotCurrentAttemptLocked()
		recorder.mu.Unlock()

		row := snapshot.toRow()
		assert.Equal(t, StatusFailed, row.CaptureStatus)
	})
}

func TestSnapshotToRowRedactsBeforeStoring(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	recorder.BeginAttempt(0)

	recorder.mu.Lock()
	recorder.clientRequest = newBoundedBuffer(4096)
	recorder.clientRequest.Write([]byte(`{"api_key":"sk-super-secret-value"}`))
	recorder.upstreamReq = newBoundedBuffer(4096)
	recorder.upstreamReq.Write([]byte(`{"authorization":"Bearer sk-super-secret-value"}`))
	snapshot := recorder.snapshotCurrentAttemptLocked()
	recorder.mu.Unlock()

	row := snapshot.toRow()
	assert.NotContains(t, row.ClientRequestBody, "sk-super-secret-value")
	assert.NotContains(t, row.UpstreamRequestBody, "sk-super-secret-value")
	assert.True(t, row.Redacted)
}

func TestRecorderIsNilSafe(t *testing.T) {
	var recorder *Recorder
	assert.NotPanics(t, func() {
		recorder.SetSessionKey(SessionKey{})
		recorder.SetChannelId(1)
		recorder.SetUpstreamRequestId("x")
		recorder.SetUpstreamResponseId("y")
		recorder.BeginAttempt(0)
		recorder.CaptureClientRequest(nil)
		recorder.CaptureUpstreamRequest(nil)
		recorder.CaptureStreamFrame("data")
		recorder.WrapResponseBody(nil)
		recorder.MarkAttemptFailed()
		recorder.Finalize()
	})
}

func TestFromContextReturnsNilWhenNotAttached(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	assert.Nil(t, FromContext(c), "未挂载 Recorder 时必须返回 nil，让调用点走原有路径")
	assert.Nil(t, FromContext(nil))
}

func TestConcurrentStreamFrameCapture(t *testing.T) {
	recorder := newTestRecorder(t, nil)
	recorder.BeginAttempt(0)

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			recorder.CaptureStreamFrame(`{"delta":"x"}`)
			_ = n
		}(i)
	}
	wg.Wait()

	recorder.mu.Lock()
	buffer := recorder.upstreamResp
	recorder.mu.Unlock()
	require.NotNil(t, buffer)
	assert.Positive(t, buffer.Total(), "并发写入不得丢数据或 panic")
}

func TestDeriveSessionKeyPriority(t *testing.T) {
	cases := []struct {
		name         string
		input        SessionKeyInput
		expectedKind string
	}{
		{
			name: "prompt_cache_key wins over user",
			input: SessionKeyInput{
				PromptCacheKey: "cache-key-1",
				User:           []byte(`"user-1"`),
				Metadata:       []byte(`{"user_id":"meta-1"}`),
			},
			expectedKind: SessionKeyKindExplicit,
		},
		{
			name: "metadata user_id wins over user",
			input: SessionKeyInput{
				Metadata: []byte(`{"user_id":"meta-1"}`),
				User:     []byte(`"user-1"`),
			},
			expectedKind: SessionKeyKindExplicit,
		},
		{
			name:         "user only",
			input:        SessionKeyInput{User: []byte(`"user-1"`)},
			expectedKind: SessionKeyKindExplicit,
		},
		{
			name:         "previous_response_id",
			input:        SessionKeyInput{PreviousResponseID: "resp_123"},
			expectedKind: SessionKeyKindResponseChain,
		},
		{
			name:         "heuristic fallback",
			input:        SessionKeyInput{TokenId: 7, ModelName: "gpt-test", SystemPrompt: "you are helpful"},
			expectedKind: SessionKeyKindHeuristic,
		},
		{
			name:         "nothing available",
			input:        SessionKeyInput{},
			expectedKind: SessionKeyKindEmpty,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key := DeriveSessionKey(tc.input)
			assert.Equal(t, tc.expectedKind, key.Kind)
			if tc.expectedKind == SessionKeyKindEmpty {
				assert.Empty(t, key.Key)
			} else {
				assert.NotEmpty(t, key.Key)
			}
		})
	}
}

func TestDeriveSessionKeyIsStableAndOpaque(t *testing.T) {
	input := SessionKeyInput{PromptCacheKey: "cache-key-1"}
	first := DeriveSessionKey(input)
	second := DeriveSessionKey(input)

	assert.Equal(t, first.Key, second.Key, "相同输入必须产生相同键")
	assert.NotContains(t, first.Key, "cache-key-1", "键不得包含客户端原始值")
	assert.LessOrEqual(t, len(first.Key), 191, "键长度必须适配 varchar(191) 索引列")
}

func TestDeriveSessionKeySeparatesDifferentHeuristicConversations(t *testing.T) {
	base := SessionKeyInput{TokenId: 7, ModelName: "gpt-test", SystemPrompt: "you are helpful"}
	other := SessionKeyInput{TokenId: 7, ModelName: "gpt-test", SystemPrompt: "you are a pirate"}

	assert.NotEqual(t, DeriveSessionKey(base).Key, DeriveSessionKey(other).Key,
		"不同 system 提示词应分到不同会话")
}

func TestSessionKeyInputFromOpenAIChat(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		PromptCacheKey: "cache-key-1",
		Messages: []dto.Message{
			{Role: "system", Content: "you are helpful"},
			{Role: "user", Content: "hi"},
		},
	}
	input := SessionKeyInputFromOpenAIChat(7, "gpt-test", req)
	assert.Equal(t, "cache-key-1", input.PromptCacheKey)
	assert.Equal(t, "you are helpful", input.SystemPrompt)
}

func TestSessionKeyInputFromClaudeUsesMetadataUserID(t *testing.T) {
	req := &dto.ClaudeRequest{
		System:   "you are helpful",
		Metadata: []byte(`{"user_id":"meta-1"}`),
	}
	key := DeriveSessionKey(SessionKeyInputFromClaude(7, "claude-test", req))
	assert.Equal(t, SessionKeyKindExplicit, key.Kind)
}

func TestSessionKeyInputFromResponsesUsesPreviousResponseID(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{PreviousResponseID: "resp_123"}
	key := DeriveSessionKey(SessionKeyInputFromResponses(7, "gpt-test", req))
	assert.Equal(t, SessionKeyKindResponseChain, key.Kind)
}

func TestSessionKeyInputForRequestHandlesUnknownAndNil(t *testing.T) {
	assert.NotPanics(t, func() {
		nilKey := DeriveSessionKey(SessionKeyInputForRequest(1, "m", nil))
		assert.Equal(t, SessionKeyKindHeuristic, nilKey.Kind, "无请求体时应退化为启发式分组")
	})
}

// trackingBody 记录 Close 是否被调用，用于验证 Tee 不破坏取消语义。
type trackingBody struct {
	io.Reader
	closed bool
}

func (b *trackingBody) Close() error {
	b.closed = true
	return nil
}

// persist 走 gopool 异步落库，端到端测试需要等待它完成。
const (
	asyncPersistTimeout  = 3 * time.Second
	asyncPersistInterval = 20 * time.Millisecond
)
