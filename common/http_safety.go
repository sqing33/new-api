package common

import (
	"net"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// responseHeaderTimeoutSeconds 解析自 RELAY_RESPONSE_HEADER_TIMEOUT,
// 0 表示关闭(回退到旧行为)。与 newRelayHTTPTransport 同一份语义。
func responseHeaderTimeoutSeconds() time.Duration {
	if RelayResponseHeaderTimeout <= 0 {
		return 0
	}
	seconds := RelayResponseHeaderTimeout
	// 溢出保护:和 service/http_client.go 保持一致
	const maxTimeoutSeconds = int64(1<<63 - 1) / int64(time.Second)
	if int64(seconds) > maxTimeoutSeconds {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

// InitDefaultSafeHTTPClient 在 main 启动早期调用,把 http.DefaultClient 和
// http.DefaultTransport 配上限定的 ResponseHeaderTimeout。这是 b518d0033
// OOM 修复(b518d0033)的关键补漏:之前只覆盖了 newRelayHTTPTransport(),其他
// 直接用 http.DefaultClient / http.DefaultTransport 的代码(video_proxy、
// ratio_sync、channel_upstream_pricing、codex_oauth、midjourney、wechat 等)
// 仍可能在 hang 的上游上无限等待,触发与 #6949 同款的 OOM 链路。
//
// 同时给 gorilla/websocket DefaultDialer 设 HandshakeTimeout(同样的值),
// 覆盖 relay/channel/api_request.go 与 volcengine/tts.go 里的 websocket 上游。
func InitDefaultSafeHTTPClient() {
	rht := responseHeaderTimeoutSeconds()

	// 配置 http.DefaultTransport
	configureDefaultTransport(rht)

	// 配置 http.DefaultClient 走同一个 transport(并保留 DefaultClient 的
	// CheckRedirect / Jar 设置;不覆盖 Timeout 因为 0 = no timeout,长流式需要)
	http.DefaultClient.Transport = http.DefaultTransport

	// 配置 websocket DefaultDialer(影响使用 gorilla/websocket.DefaultDialer 的所有代码)
	if rht > 0 {
		websocket.DefaultDialer.HandshakeTimeout = rht
	}
}

func configureDefaultTransport(rht time.Duration) {
	if tr, ok := http.DefaultTransport.(*http.Transport); ok && tr != nil {
		// 不能修改原 DefaultTransport(它是全局共享,3rd party 也许有依赖默认
		// 无 ResponseHeaderTimeout 的行为)。Clone 出一个新 transport 并替换。
		newTr := tr.Clone()
		if rht > 0 {
			newTr.ResponseHeaderTimeout = rht
		}
		// 给 dialer 加上 30s 默认(原 DefaultTransport 默认无限)
		if newTr.DialContext == nil {
			newTr.DialContext = (&net.Dialer{Timeout: 30 * time.Second}).DialContext
		}
		http.DefaultTransport = newTr
	}
}
