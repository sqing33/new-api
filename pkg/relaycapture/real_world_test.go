package relaycapture

import (
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRealWorldBodyFitsAfterStripping 复刻线上真实情形：
// 请求体 1.7MB，其中绝大部分是重复的项目上下文文本，外加一张 base64 图片。
// 剥离二进制后应能基本完整保留（不再整段截断）。
func TestRealWorldBodyFitsAfterStripping(t *testing.T) {
	systemPrompt := "<system-reminder>\n用户偏好：大规模清理先出方案\n</system-reminder>\n"
	history := strings.Repeat(`{"role":"user","content":"请继续"},{"role":"assistant","content":"好的"},`, 300)
	b64 := strings.Repeat("iVBORw0KGgoAAAANSUhEUg", 5000) // ~120KB base64
	body := `{"model":"m","messages":[{"role":"system","content":"` + systemPrompt + `"},` +
		history + `{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,` + b64 + `"}},{"type":"text","text":"LATEST-QUESTION"}]}]}`

	t.Logf("原始大小: %d 字节 (%.1f MB)", len(body), float64(len(body))/1024/1024)

	buf := newStripBoundedBuffer(49152)
	n, err := buf.Write([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, len(body), n)

	out := buf.String()
	t.Logf("剔除二进制后存储: %d 字节 (Truncated=%v)", len(out), buf.Truncated())

	assert.NotContains(t, out, b64[:200], "base64 必须被剔除")
	assert.Contains(t, out, "LATEST-QUESTION", "最新提问必须保留")
	assert.Contains(t, out, "用户偏好", "system prompt 必须保留")
}

// TestLongTextTruncationKeepsBothEnds 验证超长纯文本（无法剥离二进制）时，
// 开头与结尾都能保留 —— 这是 LLM 请求最需要看的两端。
func TestLongTextTruncationKeepsBothEnds(t *testing.T) {
	head := `{"model":"m","messages":[{"role":"system","content":"SYSTEM-RULES-AT-THE-VERY-BEGINNING"},`
	tail := `{"role":"user","content":"WHAT-I-JUST-ASKED"}]}`
	body := head + strings.Repeat(`{"role":"assistant","content":"`+strings.Repeat("z", 200)+`"},`, 400) + tail

	buf := newStripBoundedBuffer(49152)
	_, err := buf.Write([]byte(body))
	require.NoError(t, err)
	out := buf.String()

	t.Logf("原始 %d 字节 → 存储 %d 字节, Truncated=%v", buf.Total(), len(out), buf.Truncated())
	assert.Contains(t, out, "SYSTEM-RULES-AT-THE-VERY-BEGINNING", "开头必须保留")
	assert.Contains(t, out, "WHAT-I-JUST-ASKED", "结尾必须保留")
	assert.Contains(t, out, "truncated", "必须标注中间丢弃")
}

var _ = bytes.MinRead
