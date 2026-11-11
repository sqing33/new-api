package relaycapture

import (
	"fmt"
	"io"
	"net/http"

	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// contextKey 是 Recorder 在 gin.Context 上的存放键。
const contextKey = "key_relay_capture"

// CaptureStatus 取值。
const (
	// StatusOK 表示三份载荷按配置采集完成（可能含截断）。
	StatusOK = "ok"
	// StatusPartial 表示部分载荷缺失，例如上游报错导致无响应体。
	StatusPartial = "partial"
	// StatusFailed 表示采集过程出错。
	StatusFailed = "failed"
)

// boundedBuffer 是有上限的字节缓冲。
//
// 两个关键设计：
//
//  1. 当 stripBinary 为真时，写入的字节先经过 binaryStripper 剔除内联二进制，
//     再占用配额。这一步必须在截断之前完成：否则 base64 图片会先吃掉配额，
//     缓冲在图片中间被截断，之后任何 JSON 解析都会失败，用户只能看到乱码。
//
//  2. 超限时保留「头部 + 尾部」而不是只留头部。LLM 请求的结构决定了
//     最有价值的信息分布在两端：system prompt 在开头，最新一条用户消息在
//     结尾。只留头部会让管理员恰好错过最想看的最后一条消息，因此这里按
//     headRatio 切成 head + tail，中间用显式标记表示丢弃的字节数。
type boundedBuffer struct {
	limit     int
	headLimit int
	tailLimit int

	head []byte // 前段内容
	tail []byte // 后段内容（滚动保留末尾 tailLimit 字节）

	total       int
	truncated   bool
	stripBinary bool
	stripper    *binaryStripper
}

// headRatio 是超限时留给前段的比例。0.6 让开头能看到完整的 system prompt 与
// 首轮消息，同时把 40% 留给结尾的最新用户输入。
const headRatioNum, headRatioDen = 6, 10

func newBoundedBuffer(limit int) *boundedBuffer {
	if limit < 0 {
		limit = 0
	}
	headLimit := limit * headRatioNum / headRatioDen
	return &boundedBuffer{
		limit:     limit,
		headLimit: headLimit,
		tailLimit: limit - headLimit,
	}
}

// newStripBoundedBuffer 返回一个先剔除二进制再计配额的缓冲。
//
// total（原始字节数）与存储内容刻意分开统计：
// total 用于告诉管理员「这段本来有多大」，存储内容用于展示。
func newStripBoundedBuffer(limit int) *boundedBuffer {
	b := newBoundedBuffer(limit)
	b.stripBinary = true
	b.stripper = newBinaryStripper(writerFunc(func(p []byte) (int, error) {
		b.rawWrite(p)
		return len(p), nil
	}))
	return b
}

// writerFunc 让普通函数满足 writerOnly。
type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

// Write 实现 io.Writer，供 io.Copy 与 io.TeeReader 使用。
// 始终返回 len(p)，因此 io.Copy 不会因短写而报错。
func (b *boundedBuffer) Write(p []byte) (int, error) {
	b.total += len(p)
	if b.stripBinary && b.stripper != nil {
		return b.stripper.Write(p)
	}
	b.rawWrite(p)
	return len(p), nil
}

// rawWrite 按 head/tail 两段策略写入。
func (b *boundedBuffer) rawWrite(p []byte) {
	if len(p) == 0 {
		return
	}

	// 先填 head。
	if len(b.head) < b.headLimit {
		remaining := b.headLimit - len(b.head)
		if len(p) <= remaining {
			b.head = append(b.head, p...)
			return
		}
		b.head = append(b.head, p[:remaining]...)
		p = p[remaining:]
	}

	// 余下内容进入 tail 滚动窗口。
	b.truncated = true
	if b.tailLimit <= 0 {
		return
	}
	b.tail = append(b.tail, p...)
	if len(b.tail) > b.tailLimit {
		b.tail = append(b.tail[:0], b.tail[len(b.tail)-b.tailLimit:]...)
	}
}

// truncatedMarker 是内容中间被丢弃部分的说明，让读者明确知道不连续。
func (b *boundedBuffer) truncatedMarker() string {
	dropped := b.total - len(b.head) - len(b.tail)
	if dropped < 0 {
		dropped = 0
	}
	return fmt.Sprintf("\n\n...[truncated %d bytes]...\n\n", dropped)
}

func (b *boundedBuffer) appendString(value string) {
	_, _ = b.Write(common.StringToByteSlice(value))
}

// String 返回可展示内容。超限时返回 head + 标记 + tail。
func (b *boundedBuffer) String() string {
	if !b.truncated {
		return string(b.head)
	}
	return string(b.head) + b.truncatedMarker() + string(b.tail)
}

func (b *boundedBuffer) Total() int {
	return b.total
}

func (b *boundedBuffer) Truncated() bool {
	return b.truncated
}

// newBufferForCapture 按配置选择是否在截断前剥离内联二进制。
//
// CaptureBinary 为 true 表示管理员希望保留二进制原文，此时不做剥离。
func newBufferForCapture(limit int, captureBinary bool) *boundedBuffer {
	if captureBinary {
		return newBoundedBuffer(limit)
	}
	return newStripBoundedBuffer(limit)
}

// Recorder 采集一次客户端请求下所有 attempt 的载荷。
//
// 生命周期等于一次 controller.Relay 调用。字节缓冲归 Recorder 所有，与
// common.BodyStorage 解耦——storage 会在 BodyStorageCleanup 中被关闭，
// Recorder 不能持有它。
//
// 并发：relay 主 goroutine 与 StreamScannerHandler 的 scanner goroutine 都会
// 访问本对象，故所有可变状态由 mu 保护。
type Recorder struct {
	mu sync.Mutex

	setting *operation_setting.PayloadCaptureSetting
	limit   int

	requestId string
	meta      RequestMeta

	clientRequest *boundedBuffer
	clientDone    bool

	// 当前 attempt 的缓冲。BeginAttempt 时重建。
	attemptIndex   int
	upstreamReq    *boundedBuffer
	upstreamResp   *boundedBuffer
	upstreamReqID  string
	upstreamRespID string
	attemptActive  bool
	attemptHasResp bool
	attemptFailed  bool

	session SessionKey

	// finalized 保证 Finalize 只落库一次。
	finalized bool
}

// RequestMeta 是一次客户端请求的静态元信息，写入每条 attempt 记录。
type RequestMeta struct {
	UserId      int
	TokenId     int
	TokenName   string
	ModelName   string
	Group       string
	RelayFormat string
	RequestPath string
	IsStream    bool
	ChannelId   int
}

// Enabled 判断当前配置是否应启用采集。调用方在 relay 入口用它做一次快速判断，
// 为 false 时不创建 Recorder、不读取任何 body 副本。
func Enabled(tokenId int) bool {
	setting := operation_setting.GetPayloadCaptureSetting()
	if setting == nil || !setting.Enabled {
		return false
	}
	return !setting.IsTokenDisabled(tokenId)
}

// Attach 在 gin.Context 上创建并挂载 Recorder。已存在时复用，
// 避免重试循环重复创建。
func Attach(c *gin.Context, requestId string, meta RequestMeta) *Recorder {
	if c == nil {
		return nil
	}
	if existing, ok := c.Get(contextKey); ok {
		if rec, ok := existing.(*Recorder); ok && rec != nil {
			return rec
		}
	}
	setting := operation_setting.GetPayloadCaptureSetting()
	rec := &Recorder{
		setting:   setting,
		limit:     setting.MaxPayloadBytesOrDefault(),
		requestId: requestId,
		meta:      meta,
		session:   SessionKey{Kind: SessionKeyKindEmpty},
	}
	c.Set(contextKey, rec)
	return rec
}

// FromContext 取出挂在 gin.Context 上的 Recorder，不存在时返回 nil。
// 所有采集调用点都必须容忍 nil，这样关闭采集时代码路径与今天完全一致。
func FromContext(c *gin.Context) *Recorder {
	if c == nil {
		return nil
	}
	value, exists := c.Get(contextKey)
	if !exists {
		return nil
	}
	rec, _ := value.(*Recorder)
	return rec
}

// SetSessionKey 记录本次请求的会话分组结果。
func (r *Recorder) SetSessionKey(key SessionKey) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.session = key
}

// SetChannelId 在渠道选定后补齐渠道 id。
func (r *Recorder) SetChannelId(channelId int) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.meta.ChannelId = channelId
}

// SetUpstreamRequestId 记录上游返回的 request id。
func (r *Recorder) SetUpstreamRequestId(value string) {
	if r == nil || value == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upstreamReqID = value
}

// SetUpstreamResponseId 记录上游返回的 response id。
// 客户端下一轮的 previous_response_id 会回传它，用于 L2 链式聚合。
func (r *Recorder) SetUpstreamResponseId(value string) {
	if r == nil || value == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upstreamRespID = value
}

// CaptureClientRequest 采集客户端原始请求体。
//
// 通过 storage.NewReader() 取独立游标的副本，不会移动 storage 自身的读位置，
// 因此后续的 ConvertRequest / 转发读取完全不受影响。每个请求只采集一次。
func (r *Recorder) CaptureClientRequest(storage common.BodyStorage) {
	if r == nil || storage == nil || r.setting == nil || !r.setting.CaptureClientRequest {
		return
	}
	r.mu.Lock()
	if r.clientDone {
		r.mu.Unlock()
		return
	}
	r.clientDone = true
	limit := r.limit
	r.mu.Unlock()

	reader, err := storage.NewReader()
	if err != nil {
		common.SysError("relay capture: failed to open client request reader: " + err.Error())
		return
	}
	defer reader.Close()

	buffer := newBufferForCapture(limit, r.setting.CaptureBinary)
	if _, err := io.Copy(buffer, reader); err != nil {
		common.SysError("relay capture: failed to read client request body: " + err.Error())
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.clientRequest = buffer
}

// BeginAttempt 开始一次新的上游尝试，并落库上一次尝试的记录。
//
// attemptIndex 对应 relayInfo.RetryIndex（0 为首次尝试）。每次 BeginAttempt
// 会先把上一个 attempt 的缓冲写入数据库，保证多 attempt 各自独立成行。
func (r *Recorder) BeginAttempt(attemptIndex int) {
	if r == nil {
		return
	}
	r.mu.Lock()
	previous := r.snapshotCurrentAttemptLocked()
	r.attemptIndex = attemptIndex
	r.upstreamReq = nil
	r.upstreamResp = nil
	r.upstreamReqID = ""
	r.upstreamRespID = ""
	r.attemptActive = true
	r.attemptHasResp = false
	r.attemptFailed = false
	r.mu.Unlock()

	if previous != nil {
		r.persist(previous)
	}
}

// CaptureUpstreamRequest 采集真正发往上游的请求体。
//
// 必须使用 req.GetBody()：它由 ApplyUpstreamBodyMetadata 设为可重放 reader，
// 返回独立副本。绝不能读 req.Body，那会消费掉真正要发送的 body，导致上游
// 收到空请求。req.GetBody 为 nil（bodyless 请求）时直接跳过。
func (r *Recorder) CaptureUpstreamRequest(req *http.Request) {
	if r == nil || req == nil || r.setting == nil || !r.setting.CaptureUpstreamRequest {
		return
	}
	if req.GetBody == nil {
		return
	}
	reader, err := req.GetBody()
	if err != nil {
		common.SysError("relay capture: failed to replay upstream request body: " + err.Error())
		return
	}
	defer reader.Close()

	r.mu.Lock()
	limit := r.limit
	active := r.attemptActive
	r.mu.Unlock()
	if !active {
		return
	}

	buffer := newBufferForCapture(limit, r.setting.CaptureBinary)
	if _, err := io.Copy(buffer, reader); err != nil {
		common.SysError("relay capture: failed to read upstream request body: " + err.Error())
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.attemptActive {
		return
	}
	r.upstreamReq = buffer
}

// CaptureStreamFrame 采集一帧转发给客户端的流式响应。
//
// 采集点在 scanner goroutine 内同步执行，因此这里只做一次有界 append，
// 不做任何 I/O、不写数据库、不加锁以外的阻塞操作，以免挤占转发节奏。
//
// 由于不包装 resp.Body，此方式不受任何替换 resp.Body 的渠道实现影响。
func (r *Recorder) CaptureStreamFrame(data string) {
	if r == nil || data == "" || r.setting == nil || !r.setting.CaptureUpstreamResponse {
		return
	}
	if r.setting.CaptureRawUpstreamResponse {
		// 原始字节模式由 WrapResponseBody 的 Tee 负责，帧回调不重复累积。
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.attemptActive {
		return
	}
	if r.upstreamResp == nil {
		r.upstreamResp = newBufferForCapture(r.limit, r.setting.CaptureBinary)
	}
	r.upstreamResp.appendString(data)
	r.upstreamResp.appendString("\n")
	r.attemptHasResp = true
}

// WrapResponseBody 在原始字节模式下用 io.TeeReader 旁路采集上游响应。
//
// 仅当 CaptureRawUpstreamResponse 开启时生效。已知限制：会替换 resp.Body 的
// 渠道（如 minimax 的 replayReadCloser）会丢弃该包装，导致采不到响应体。
//
// 该方法不持有 resp.Body 的所有权，也不改变其 Close 语义。
func (r *Recorder) WrapResponseBody(resp *http.Response) {
	if r == nil || resp == nil || resp.Body == nil {
		return
	}
	if r.setting == nil || !r.setting.CaptureUpstreamResponse || !r.setting.CaptureRawUpstreamResponse {
		return
	}
	r.mu.Lock()
	if !r.attemptActive {
		r.mu.Unlock()
		return
	}
	buffer := newBufferForCapture(r.limit, r.setting.CaptureBinary)
	r.upstreamResp = buffer
	r.attemptHasResp = true
	r.mu.Unlock()

	resp.Body = &teeReadCloser{
		reader: io.TeeReader(resp.Body, buffer),
		closer: resp.Body,
		buffer: buffer,
	}
}

// MarkAttemptFailed 标记当前 attempt 以失败告终。
// 失败 attempt 仍会落库，且上游错误响应体对排查最有价值。
func (r *Recorder) MarkAttemptFailed() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.attemptFailed = true
}

// Finalize 落库最后一个 attempt 并结束采集。重复调用无副作用。
func (r *Recorder) Finalize() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.finalized {
		r.mu.Unlock()
		return
	}
	r.finalized = true
	last := r.snapshotCurrentAttemptLocked()
	r.attemptActive = false
	r.mu.Unlock()

	if last != nil {
		r.persist(last)
	}
}

// attemptSnapshot 是一次 attempt 的完整快照，与 Recorder 解耦，可安全跨
// goroutine 传递。
type attemptSnapshot struct {
	requestId    string
	attemptIndex int
	meta         RequestMeta
	session      SessionKey
	limit        int

	clientBody   *boundedBuffer
	upstreamReq  *boundedBuffer
	upstreamResp *boundedBuffer

	upstreamReqID  string
	upstreamRespID string

	hasResponse   bool
	failed        bool
	captureBinary bool
}

// snapshotCurrentAttemptLocked 在持锁状态下取出当前 attempt 的快照。
// 当前 attempt 尚未开始时返回 nil。
func (r *Recorder) snapshotCurrentAttemptLocked() *attemptSnapshot {
	if !r.attemptActive {
		return nil
	}
	return &attemptSnapshot{
		requestId:      r.requestId,
		attemptIndex:   r.attemptIndex,
		meta:           r.meta,
		session:        r.session,
		limit:          r.limit,
		clientBody:     r.clientRequest,
		upstreamReq:    r.upstreamReq,
		upstreamResp:   r.upstreamResp,
		upstreamReqID:  r.upstreamReqID,
		upstreamRespID: r.upstreamRespID,
		hasResponse:    r.attemptHasResp,
		failed:         r.attemptFailed,
		captureBinary:  r.setting != nil && r.setting.CaptureBinary,
	}
}

// persist 异步落库一个 attempt 快照。
//
// 采集是旁路：任何失败都只记录日志，绝不影响主请求。快照内的字节归快照所有，
// 与 gin 生命周期解耦。
func (r *Recorder) persist(snapshot *attemptSnapshot) {
	if snapshot == nil {
		return
	}
	row := snapshot.toRow()
	gopool.Go(func() {
		// DB 未初始化（例如单元测试或启动早期）时直接跳过，而不是让 gopool
		// 因为 nil 指针 panic。采集失败永远不得影响主请求。
		if model.DB == nil {
			return
		}
		defer func() {
			if recovered := recover(); recovered != nil {
				common.SysError("relay capture: panic while saving request payload")
			}
		}()
		if err := model.SaveRequestPayload(row); err != nil {
			common.SysError("relay capture: failed to save request payload: " + err.Error())
		}
	})
}

// toRow 把快照转换为数据库行，并在写入前完成脱敏。
func (s *attemptSnapshot) toRow() *model.RequestPayload {
	row := &model.RequestPayload{
		RequestId:          s.requestId,
		AttemptIndex:       s.attemptIndex,
		UserId:             s.meta.UserId,
		TokenId:            s.meta.TokenId,
		TokenName:          s.meta.TokenName,
		ChannelId:          s.meta.ChannelId,
		ModelName:          s.meta.ModelName,
		Group:              s.meta.Group,
		RelayFormat:        s.meta.RelayFormat,
		RequestPath:        s.meta.RequestPath,
		IsStream:           s.meta.IsStream,
		UpstreamRequestId:  s.upstreamReqID,
		UpstreamResponseId: s.upstreamRespID,
		SessionKey:         s.session.Key,
		SessionKeyKind:     s.session.Kind,
		CaptureStatus:      StatusOK,
	}

	redacted := false
	if s.clientBody != nil {
		result := redactJSON(s.clientBody.String(), s.captureBinary)
		row.ClientRequestBody = result.Text
		row.ClientBytes = s.clientBody.Total()
		row.ClientTruncated = s.clientBody.Truncated()
		redacted = redacted || result.Redacted
	}
	if s.upstreamReq != nil {
		result := redactJSON(s.upstreamReq.String(), s.captureBinary)
		row.UpstreamRequestBody = result.Text
		row.UpstreamReqBytes = s.upstreamReq.Total()
		row.UpstreamReqTruncated = s.upstreamReq.Truncated()
		redacted = redacted || result.Redacted
	}
	if s.upstreamResp != nil {
		result := redactJSON(s.upstreamResp.String(), s.captureBinary)
		row.UpstreamResponseBody = result.Text
		row.UpstreamRespBytes = s.upstreamResp.Total()
		row.UpstreamRespTruncated = s.upstreamResp.Truncated()
		redacted = redacted || result.Redacted
	}
	row.Redacted = redacted

	if s.failed && !s.hasResponse {
		row.CaptureStatus = StatusPartial
	}
	if row.ClientRequestBody == "" && row.UpstreamRequestBody == "" && row.UpstreamResponseBody == "" {
		row.CaptureStatus = StatusFailed
	}
	return row
}

// teeReadCloser 让 io.TeeReader 保留原始 body 的 Close 语义。
//
// 它不接管底层 body 的生命周期：Close 直接委托给原 reader，因此不会破坏
// 「客户端断开时立即关闭上游 resp.Body」的行为。
type teeReadCloser struct {
	reader io.Reader
	closer io.Closer
	buffer *boundedBuffer
}

func (t *teeReadCloser) Read(p []byte) (int, error) {
	return t.reader.Read(p)
}

func (t *teeReadCloser) Close() error {
	return t.closer.Close()
}
