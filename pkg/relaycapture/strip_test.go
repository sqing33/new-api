package relaycapture

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStripBoundedBufferRemovesBase64BeforeQuota(t *testing.T) {
	// 30KB 的 base64 塞在 64KB 预算里：剥离后正文远小于配额，不应被截断。
	bigB64 := strings.Repeat("A", 30000)
	body := `{"model":"m","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,` + bigB64 + `"}}]}]}`

	buf := newStripBoundedBuffer(49152)
	n, err := buf.Write([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, len(body), n, "Write 必须报告消费全部输入")

	out := buf.String()
	assert.NotContains(t, out, bigB64[:200], "base64 必须被剔除")
	assert.Contains(t, out, "[binary omitted: image/png", "应带 MIME 的占位符")
	assert.Contains(t, out, `"model":"m"`, "文本部分必须保留")
	assert.False(t, buf.Truncated(), "剥离后远小于配额，不应截断")
	t.Logf("原始 %d 字节 → 存储 %d 字节", buf.Total(), len(out))
}

func TestStripBoundedBufferHandlesChunkBoundary(t *testing.T) {
	// base64 跨 Write 分块时也必须识别（io.Copy 与流式帧都会这样切）。
	b64 := strings.Repeat("B", 5000)
	buf := newStripBoundedBuffer(49152)
	payload := `{"url":"data:image/jpeg;base64,` + b64 + `"}`
	for i := 0; i < len(payload); i += 7 {
		end := min(i+7, len(payload))
		_, err := buf.Write([]byte(payload[i:end]))
		require.NoError(t, err)
	}
	out := buf.String()
	assert.NotContains(t, out, b64[:100], "跨块 base64 也必须被剔除")
	assert.Contains(t, out, "binary omitted")
}

func TestStripBoundedBufferKeepsNormalText(t *testing.T) {
	body := `{"model":"gpt-test","messages":[{"role":"user","content":"hello world, this is normal text with punctuation."}]}`
	buf := newStripBoundedBuffer(49152)
	_, err := buf.Write([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, body, buf.String(), "普通文本必须逐字节保留")
}

func TestStripBoundedBufferKeepsShortBase64LikeIds(t *testing.T) {
	// 64 位哈希与常见 ID 都是 base64 字母表字符，但远低于阈值，必须保留。
	hash := strings.Repeat("a1B2c3D4", 8) // 64 字符
	body := `{"sha256":"` + hash + `"}`
	buf := newStripBoundedBuffer(49152)
	_, _ = buf.Write([]byte(body))
	assert.Contains(t, buf.String(), hash, "短哈希不得被误判为二进制")
}
