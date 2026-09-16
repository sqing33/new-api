package minimax

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	channelconstant "github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
)

// The chat endpoint reports business failures inside a HTTP 200 envelope
// (base_resp) together with a null choices array, so the shared OpenAI handlers
// read an exhausted plan as a successful empty completion. The status codes
// below restore the semantics the envelope hides; an unmapped code surfaces as
// 502 because the upstream answered with something that is not a valid success.
var miniMaxBusinessStatusCodes = map[int64]int{
	1004: http.StatusUnauthorized,
	2056: http.StatusTooManyRequests,
	2062: http.StatusTooManyRequests,
}

// replayReadCloser feeds the inspected prefix back to the downstream handler
// while keeping Close bound to the upstream body.
type replayReadCloser struct {
	io.Reader
	io.Closer
}

func inspectChatBusinessError(resp *http.Response, info *relaycommon.RelayInfo) *types.NewAPIError {
	if resp == nil || resp.Body == nil {
		return nil
	}
	if info.IsStream {
		return inspectStreamBusinessError(resp)
	}
	return inspectBodyBusinessError(resp)
}

func inspectBodyBusinessError(resp *http.Response) *types.NewAPIError {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		resp.Body.Close()
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	if newAPIError := miniMaxBusinessError(body); newAPIError != nil {
		resp.Body.Close()
		return newAPIError
	}
	resp.Body = replayReadCloser{Reader: bytes.NewReader(body), Closer: resp.Body}
	return nil
}

func inspectStreamBusinessError(resp *http.Response) *types.NewAPIError {
	upstream := resp.Body
	reader := bufio.NewReaderSize(upstream, streamProbeBufferSize)

	type frameResult struct {
		consumed string
		payload  string
		err      error
	}
	results := make(chan frameResult, 1)
	go func() {
		frame := readFirstStreamFrame(reader)
		results <- frameResult{consumed: frame.consumed, payload: frame.payload, err: frame.err}
	}()

	var frame frameResult
	timeout := time.Duration(channelconstant.StreamingTimeout) * time.Second
	if timeout <= 0 {
		timeout = streamProbeTimeout
	}
	select {
	case frame = <-results:
	case <-time.After(timeout):
		upstream.Close()
		return types.NewErrorWithStatusCode(
			fmt.Errorf("upstream stream sent no data within %s", timeout),
			types.ErrorCodeBadResponse,
			http.StatusGatewayTimeout,
		)
	}

	if frame.payload == "" {
		resp.Body = replayReadCloser{Reader: io.MultiReader(strings.NewReader(frame.consumed), reader), Closer: upstream}
		return nil
	}
	if newAPIError := miniMaxBusinessError([]byte(frame.payload)); newAPIError != nil {
		upstream.Close()
		return newAPIError
	}
	resp.Body = replayReadCloser{
		Reader: io.MultiReader(strings.NewReader(frame.consumed), reader),
		Closer: upstream,
	}
	return nil
}

// streamProbeBufferSize bounds how much of a stream is buffered while looking
// for the opening frame; a larger opening frame is left to the shared stream
// handler instead of being inspected.
const streamProbeBufferSize = 64 << 10

const streamProbeTimeout = 300 * time.Second

type streamFrame struct {
	consumed string
	payload  string
	err      error
}

// readFirstStreamFrame consumes bytes up to the first line carrying content,
// skipping the SSE comments and blank lines that may precede it. Every byte it
// consumed is reported in consumed so the caller can replay it.
func readFirstStreamFrame(reader *bufio.Reader) streamFrame {
	var consumed strings.Builder
	for {
		line, err := reader.ReadSlice('\n')
		consumed.Write(line)
		trimmed := strings.TrimSpace(string(line))
		if errors.Is(err, bufio.ErrBufferFull) || (trimmed != "" && !strings.HasPrefix(trimmed, ":")) || err != nil {
			return streamFrame{consumed: consumed.String(), payload: trimmed, err: err}
		}
	}
}

func miniMaxBusinessError(body []byte) *types.NewAPIError {
	line := strings.TrimSpace(string(body))
	line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if line == "" || line == "[DONE]" {
		return nil
	}
	var envelope struct {
		BaseResp MiniMaxBaseResp `json:"base_resp"`
	}
	if err := common.Unmarshal(common.StringToByteSlice(line), &envelope); err != nil {
		return nil
	}
	if envelope.BaseResp.StatusCode == 0 {
		return nil
	}
	statusCode, ok := miniMaxBusinessStatusCodes[envelope.BaseResp.StatusCode]
	if !ok {
		statusCode = http.StatusBadGateway
	}
	return types.NewErrorWithStatusCode(
		fmt.Errorf("minimax error: %d - %s", envelope.BaseResp.StatusCode, envelope.BaseResp.StatusMsg),
		types.ErrorCodeBadResponse,
		statusCode,
	)
}
