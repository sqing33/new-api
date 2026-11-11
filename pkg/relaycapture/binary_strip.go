package relaycapture

import (
	"fmt"
	"strings"
)

// binaryStripper 在写入下游缓冲之前把内联二进制从正文里剔除。
//
// 为什么必须在这一层而不是入库前的 redactJSON 里做：正文先经过有界缓冲
// 截断（MaxPayloadBytes），一旦 base64 图片占了配额，缓冲就已经在图片中间
// 被截断，此后任何 JSON 解析都会失败，脱敏与占位替换也就无从下手——最终用户
// 看到的就是一段被截断的乱码。因此必须在字节流进入配额之前就把二进制换成
// 占位符。
//
// 判定规则（不依赖 JSON 解析，可安全处理被任意位置切断的分块）：
//   - 连续 base64 字母表字符超过阈值即视为二进制；
//   - data URI（data:...;base64,...）会额外带上 MIME 提示。
//
// 阈值取 256 是有意的：正常代码与文本里不会出现几百个连续的无空白字母数字，
// 而 64 位哈希（64 字符）与常见 ID 都远低于该阈值。
const (
	// base64RunThreshold 是判定「这是一段二进制」的连续字符阈值。
	base64RunThreshold = 256
	// mimeLookbackLimit 是回溯查找 data URI 前缀的最大字节数。
	mimeLookbackLimit = 200
)

var base64Alphabet = func() [256]bool {
	var table [256]bool
	for _, r := range "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-" {
		table[r] = true
	}
	return table
}()

// writerOnly 是 binaryStripper 需要的下游接口。
type writerOnly interface {
	Write(p []byte) (int, error)
}

// binaryStripper 是有状态的流式过滤器。
//
// 关键设计：连续 base64 字符并不立刻下发，而是先攒在 pendingRun 里；
// 只有确认这段 run 结束（遇到非字母表字符）才连同该字符一起下发。
// 这样跨 Write 分块的 base64 也能被正确识别与丢弃。
type binaryStripper struct {
	out writerOnly

	pendingRun []byte // 尚未下发的连续 base64 字符
	skipping   bool   // 正在丢弃二进制段
	skipped    int    // 当前二进制段已丢弃的字节数
	lookback   []byte // 最近下发内容的尾部，用于识别 data URI 的 MIME
	scratch    []byte // 单次 Write 的拼装缓冲
}

func newBinaryStripper(out writerOnly) *binaryStripper {
	return &binaryStripper{out: out}
}

// Write 过滤后转发，语义上消费全部输入。
func (s *binaryStripper) Write(p []byte) (int, error) {
	consumed := len(p)
	s.scratch = s.scratch[:0]

	flushRun := func() {
		if len(s.pendingRun) == 0 {
			return
		}
		s.scratch = append(s.scratch, s.pendingRun...)
		s.lookback = appendTrimmed(s.lookback, s.pendingRun, mimeLookbackLimit)
		s.pendingRun = s.pendingRun[:0]
	}

	for _, b := range p {
		if s.skipping {
			// 二进制段内：跳过全部内容，直到字段结束。
			// 引号/逗号/闭合括号/空白都表明这段二进制结束。
			if isBinaryTerminator(b) {
				s.flushPlaceholder()
				s.skipping = false
				s.scratch = append(s.scratch, b)
				s.lookback = appendTrimmed(s.lookback, []byte{b}, mimeLookbackLimit)
			} else {
				s.skipped++
			}
			continue
		}

		if base64Alphabet[b] {
			s.pendingRun = append(s.pendingRun, b)
			if len(s.pendingRun) >= base64RunThreshold {
				// 达到阈值仍未中断 → 判定为二进制，丢弃已攒的 run。
				s.skipped = len(s.pendingRun)
				s.pendingRun = s.pendingRun[:0]
				s.skipping = true
			}
			continue
		}

		// 非字母表字符终结了当前 run；若它是 data URI 的分隔符，
		// 紧随其后的内容按二进制处理。
		if b == ',' && s.looksLikeDataURI() {
			s.pendingRun = s.pendingRun[:0]
			s.flushPlaceholder()
			s.skipping = true
			s.scratch = append(s.scratch, b)
			s.lookback = appendTrimmed(s.lookback, []byte{b}, mimeLookbackLimit)
			continue
		}

		flushRun()
		s.scratch = append(s.scratch, b)
		s.lookback = appendTrimmed(s.lookback, []byte{b}, mimeLookbackLimit)
	}

	if _, err := s.out.Write(s.scratch); err != nil {
		return 0, err
	}
	return consumed, nil
}

// isBinaryTerminator 判断二进制段是否在此字符处结束。
func isBinaryTerminator(b byte) bool {
	switch b {
	case '"', ',', '}', ']', ' ', '\n', '\r', '\t':
		return true
	default:
		return false
	}
}

// looksLikeDataURI 判断当前已下发内容的尾部是否是 data URI 的 base64 分隔符。
func (s *binaryStripper) looksLikeDataURI() bool {
	idx := strings.LastIndex(string(s.lookback), "data:")
	if idx < 0 {
		return false
	}
	segment := string(s.lookback[idx:])
	// data:image/png;base64,  —— 以 ;base64, 结尾即命中
	return strings.HasSuffix(segment, ";base64,")
}

// flushPlaceholder 输出二进制占位符。占位符保持极短，不复制任何原始数据。
func (s *binaryStripper) flushPlaceholder() {
	placeholder := "[binary omitted]"
	if mime := s.pendingMIME(); mime != "" {
		placeholder = fmt.Sprintf("[binary omitted: %s, %s]", mime, humanizeBytes(s.skipped))
	} else if s.skipped > 0 {
		placeholder = fmt.Sprintf("[binary omitted, %s]", humanizeBytes(s.skipped))
	}
	s.scratch = append(s.scratch, placeholder...)
	s.lookback = appendTrimmed(s.lookback, []byte(placeholder), mimeLookbackLimit)
	s.skipped = 0
}

// pendingMIME 从最近下发的内容里提取 data URI 的 MIME 类型。
func (s *binaryStripper) pendingMIME() string {
	idx := strings.LastIndex(string(s.lookback), "data:")
	if idx < 0 {
		return ""
	}
	segment := string(s.lookback[idx:])
	end := strings.Index(segment, ";base64")
	if end <= len("data:") {
		return ""
	}
	mime := segment[len("data:"):end]
	// 只要形如 type/subtype 才展示，避免把噪声当 MIME。
	if !strings.Contains(mime, "/") || len(mime) > 64 {
		return ""
	}
	return mime
}

// appendTrimmed 追加内容并只保留末尾 limit 字节。
func appendTrimmed(dst []byte, src []byte, limit int) []byte {
	dst = append(dst, src...)
	if len(dst) > limit {
		dst = append(dst[:0], dst[len(dst)-limit:]...)
	}
	return dst
}

// humanizeBytes 把字节数转成便于阅读的单位。
func humanizeBytes(n int) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := int64(n) / unit; v >= unit && exp < 4; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGT"[exp])
}
