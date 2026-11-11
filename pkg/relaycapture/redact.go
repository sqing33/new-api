// Package relaycapture 采集并留存单次上游 attempt 的三份请求上下文载荷：
// 客户端原始请求体、转换后发往上游的请求体、以及上游响应内容。
//
// 设计前提是「对客户端与上游完全无感知」：
//   - 客户端请求体与上游请求体都通过只读重放路径获取（BodyStorage.NewReader /
//     req.GetBody），绝不消费真正要发送的 body。
//   - 不新增任何响应头、不改写响应字节、不额外发起任何上游请求。
//   - 上游响应默认在流式帧回调里旁听，不包装 resp.Body，因此不受任何替换
//     resp.Body 的渠道实现影响。
//
// 采集是纯旁路：任何失败都只记录日志，绝不影响主请求。
package relaycapture

import (
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// maskedValue 是凭据脱敏后的占位值，UI 会原样展示它以说明此处曾有敏感字段。
const maskedValue = "***masked***"

// sensitiveJSONKeys 是需要脱敏的 JSON 字段名（小写比较）。
//
// key 单独命中过于宽泛，但它是 form-data 与多种兼容网关里承载凭据的常见字段名，
// 因此仍然纳入；命中后只替换值，不影响结构。
var sensitiveJSONKeys = map[string]struct{}{
	"api_key":             {},
	"apikey":              {},
	"authorization":       {},
	"token":               {},
	"access_token":        {},
	"refresh_token":       {},
	"secret":              {},
	"password":            {},
	"key":                 {},
	"x-api-key":           {},
	"x-goog-api-key":      {},
	"private_key":         {},
	"client_secret":       {},
	"session_key":         {},
	"credentials":         {},
	"proxy-authorization": {},
}

// binaryPlaceholders 描述多模态/二进制内容块在 CaptureBinary=false 时的占位文本。
// 键是内容块 type，值是替换文本。
var binaryPlaceholders = map[string]string{
	"image":       "[image omitted]",
	"image_url":   "[image omitted]",
	"input_image": "[image omitted]",
	"file":        "[file omitted]",
	"input_file":  "[file omitted]",
	"document":    "[file omitted]",
	"audio":       "[audio omitted]",
	"input_audio": "[audio omitted]",
	"video":       "[video omitted]",
}

func isSensitiveKey(key string) bool {
	_, ok := sensitiveJSONKeys[strings.ToLower(strings.TrimSpace(key))]
	return ok
}

// redactResult 汇总一次脱敏与占位处理的结果。
type redactResult struct {
	// Text 是处理后的正文。
	Text string
	// Redacted 表示是否发生过凭据脱敏。
	Redacted bool
}

// redactJSON 对 JSON 正文做凭据脱敏，并在 captureBinary=false 时把二进制内容块
// 替换为占位符。非 JSON 输入原样返回（调用方已按 Content-Type 判断）。
//
// 脱敏发生在写入缓冲之前，因此明文凭据不会在采集缓冲里驻留。
func redactJSON(raw string, captureBinary bool) redactResult {
	if raw == "" {
		return redactResult{}
	}
	if !gjson.Valid(raw) {
		return redactResult{Text: redactNonJSON(raw)}
	}

	result := raw
	redacted := false

	var walk func(path string, value gjson.Result)
	walk = func(path string, value gjson.Result) {
		switch {
		case value.IsObject():
			value.ForEach(func(key, val gjson.Result) bool {
				childPath := joinJSONPath(path, key.String())
				if isSensitiveKey(key.String()) && !val.IsObject() && !val.IsArray() {
					if updated, err := sjson.Set(result, childPath, maskedValue); err == nil {
						result = updated
						redacted = true
					}
					return true
				}
				walk(childPath, val)
				return true
			})
		case value.IsArray():
			index := 0
			value.ForEach(func(_, val gjson.Result) bool {
				walk(joinJSONIndex(path, index), val)
				index++
				return true
			})
		}
	}
	walk("", gjson.Parse(result))

	if !captureBinary {
		result, redacted = replaceBinaryBlocks(result, redacted)
	}

	return redactResult{Text: result, Redacted: redacted}
}

// replaceBinaryBlocks 把多模态内容块替换为占位符。命中两类形态：
//  1. content 数组里 type 为 image/input_audio 等的块；
//  2. data URL（data:...;base64,...）形式内联的二进制。
func replaceBinaryBlocks(raw string, alreadyRedacted bool) (string, bool) {
	result := raw
	changed := alreadyRedacted

	parsed := gjson.Parse(result)
	var walk func(path string, value gjson.Result)
	walk = func(path string, value gjson.Result) {
		switch {
		case value.IsObject():
			blockType := value.Get("type")
			if blockType.Exists() && blockType.Type == gjson.String {
				if placeholder, ok := binaryPlaceholders[blockType.String()]; ok {
					if updated, err := sjson.Set(result, path, placeholder); err == nil {
						result = updated
						changed = true
						return
					}
				}
			}
			value.ForEach(func(key, val gjson.Result) bool {
				walk(joinJSONPath(path, key.String()), val)
				return true
			})
		case value.IsArray():
			index := 0
			value.ForEach(func(_, val gjson.Result) bool {
				walk(joinJSONIndex(path, index), val)
				index++
				return true
			})
		case value.Type == gjson.String:
			if isDataURL(value.String()) {
				if updated, err := sjson.Set(result, path, "[binary omitted]"); err == nil {
					result = updated
					changed = true
				}
			}
		}
	}
	walk("", parsed)

	return result, changed
}

// isDataURL 判断字符串是否是内联的 data URL 二进制。
func isDataURL(value string) bool {
	return strings.HasPrefix(value, "data:") && strings.Contains(value, ";base64,")
}

// redactNonJSON 处理 form-urlencoded / multipart 等非 JSON 正文。
// 仅按字段名匹配脱敏，不尝试结构化解析，避免在未知编码上出错。
func redactNonJSON(raw string) string {
	if raw == "" {
		return raw
	}
	result := raw
	for key := range sensitiveJSONKeys {
		result = redactFormField(result, key)
	}
	return result
}

// redactFormField 把 name=value / "name": value / name="value" 形态里命中敏感字段名的
// 值替换为占位符。大小写不敏感。
func redactFormField(raw string, field string) string {
	lowerRaw := strings.ToLower(raw)
	lowerField := strings.ToLower(field)
	var builder strings.Builder
	// cursor 是「已写入 builder 的位置」，scan 是「已检查的位置」。
	// 两者必须分开：跳过一个不匹配的候选时只能推进 scan，否则会丢掉
	// raw[cursor:scan] 之间的正文。
	cursor := 0
	scan := 0
	for {
		idx := strings.Index(lowerRaw[scan:], lowerField)
		if idx < 0 {
			break
		}
		start := scan + idx
		afterName := start + len(field)
		if afterName >= len(raw) {
			break
		}
		// 必须是独立字段名（前一个字符不是标识符字符），且紧跟 = 或 :。
		standalone := start == 0 || !isIdentifierByte(raw[start-1])
		separator := raw[afterName]
		if !standalone || (separator != '=' && separator != ':') {
			scan = start + 1
			continue
		}
		// 跳过分隔符与可能的引号。
		valueStart := afterName + 1
		for valueStart < len(raw) && (raw[valueStart] == ' ' || raw[valueStart] == '"' || raw[valueStart] == '\'') {
			valueStart++
		}
		valueEnd := valueStart
		for valueEnd < len(raw) && !isFormValueTerminator(raw[valueEnd]) {
			valueEnd++
		}
		if valueEnd > valueStart {
			builder.WriteString(raw[cursor:valueStart])
			builder.WriteString(maskedValue)
			cursor = valueEnd
		}
		scan = max(valueEnd, start+1)
	}
	builder.WriteString(raw[cursor:])
	return builder.String()
}

func isIdentifierByte(b byte) bool {
	return b == '_' || b == '-' ||
		(b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

func isFormValueTerminator(b byte) bool {
	return b == '&' || b == '"' || b == '\'' || b == ',' || b == '}' || b == ' ' ||
		b == '\r' || b == '\n' || b == ';'
}

func joinJSONPath(parent string, key string) string {
	if parent == "" {
		return escapeJSONPathKey(key)
	}
	return parent + "." + escapeJSONPathKey(key)
}

func joinJSONIndex(parent string, index int) string {
	return parent + "." + strconv.Itoa(index)
}

// escapeJSONPathKey 处理 sjson 路径里的特殊字符（. * ? 与转义）。
func escapeJSONPathKey(key string) string {
	var builder strings.Builder
	for _, r := range key {
		switch r {
		case '.', '*', '?', '\\', '|', '#', '@':
			builder.WriteRune('\\')
		}
		builder.WriteRune(r)
	}
	return builder.String()
}
