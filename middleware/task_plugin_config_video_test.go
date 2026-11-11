package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// configDrivenChannelType and configDrivenOtherChannelType are real channel
// types that no built-in plugin claims, so tests own the channelType → plugin
// mapping outright. Neither may be ChannelTypeTaskPlugin (61), which plugin
// meta forbids declaring, nor a type a factory plugin already claims.
const configDrivenChannelType = 47

const configDrivenOtherChannelType = 48

const configDrivenDisabledChannelType = 46

func setupConfigDrivenVideoDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	previousCache := common.MemoryCacheEnabled
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB = database
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	// The memory cache is off so channel lookups read the database directly;
	// group2model2channels is a package global that other tests may have left
	// populated, and reusing it here would make results order-dependent.
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.MemoryCacheEnabled = previousCache
	})
}

func insertConfigDrivenChannel(t *testing.T, name string, channelType int, models string, status int) *model.Channel {
	t.Helper()
	channel := &model.Channel{
		Name:   name,
		Key:    "sk-" + name,
		Status: status,
		Type:   channelType,
		Models: models,
		Group:  "default",
	}
	require.NoError(t, model.DB.Create(channel).Error)
	for _, modelName := range strings.Split(models, ",") {
		ability := model.Ability{
			Group:     "default",
			Model:     modelName,
			ChannelId: channel.Id,
			Enabled:   status == common.ChannelStatusEnabled,
		}
		require.NoError(t, model.DB.Create(&ability).Error)
	}
	return channel
}

func setVideoModelSettings(t *testing.T, payload string) {
	t.Helper()
	original := setting.ImageModelSettings
	t.Cleanup(func() { setting.ImageModelSettings = original })
	require.NoError(t, setting.UpdateImageModelSettingsByJsonString(payload))
}

func configDrivenPluginSource(key string, channelType int, models string) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: %q,
  version: "1.0.0",
  author: {name: "Test"},
  channelTypes: [%d],
  models: %s,
  fetchMode: "per_task",
  protocols: [{name: "openai_responses", supports: ["stream", "sync", "background"]}],
};
export function buildSubmitRequest() { return {url: "https://example.com"}; }
export function parseSubmitResponse() { return {taskId: "one"}; }
export function buildQueryRequest() { return {url: "https://example.com"}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
export const protocols = {openai_responses: {
  decodeRequest: function(ctx) {
    return {kind: "submit", model: ctx.model, action: "text_to_video", requestBody: ctx.body.value};
  },
  renderEvents: function() { return {events: [], done: false}; },
  renderFinal: function() { return {}; }
}};
`, key, key, channelType, models)
}

// serveConfigDrivenRequest runs the shared-endpoint middleware chain and reports
// the pinned endpoint plus the recorder. A request that falls through to the Go
// relay still runs the terminal handler, so "pinned" — not "reached" — is what
// distinguishes a task-plugin claim from an ordinary fall-through.
func serveConfigDrivenRequest(t *testing.T, body string) (jsplugin.PinnedEndpoint, bool, *httptest.ResponseRecorder) {
	t.Helper()
	var pinned jsplugin.PinnedEndpoint
	pinnedPresent := false
	router := gin.New()
	router.POST("/v1/responses", PinTaskPluginEndpoint(), PrepareTaskPluginEndpoint(), func(c *gin.Context) {
		if value, exists := c.Get(jsplugin.ContextKeyPinnedEndpoint); exists {
			pinned, pinnedPresent = value.(jsplugin.PinnedEndpoint)
		}
		c.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return pinned, pinnedPresent, recorder
}

// TestConfigDrivenVideoModelRoutesThroughInferredPlugin 覆盖核心目标：模型名不在
// 插件 meta.models 里，但管理员配置了生视频能力时，仍能按渠道类型推断出驱动插件。
func TestConfigDrivenVideoModelRoutesThroughInferredPlugin(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "config-video", configDrivenChannelType, "configured-video-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[{"model":"configured-video-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	plugin, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("config-driven-plugin", configDrivenChannelType, `["declared-model"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("config-driven-plugin")) })

	generation := jsplugin.DefaultRegistry.Generation()
	_, declared := generation.CanonicalModel("configured-video-model")
	require.False(t, declared, "the model must not be declared by any plugin for this test to be meaningful")

	pinned, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"configured-video-model"}`)

	require.True(t, pinnedPresent, recorder.Body.String())
	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Same(t, plugin, pinned.Plugin)
	require.Len(t, pinned.Candidates, 1)
	// The configured name must survive verbatim: there is no declared spelling
	// to fold it to, and rewriting it would break the upstream model name.
	assert.Equal(t, "configured-video-model", pinned.Model)
	assert.Equal(t, "", pinned.MappedModel)
}

// TestConfigDrivenVideoModelWithoutChannelIsRejected 覆盖零候选：配置了生视频但没有
// 任何启用渠道能服务该模型时必须报错，不能静默放行到没有插件能处理的路径。
func TestConfigDrivenVideoModelWithoutChannelIsRejected(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	setVideoModelSettings(t, `[{"model":"orphan-video-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	_, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("orphan-plugin", configDrivenChannelType, `["declared-model"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("orphan-plugin")) })

	_, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"orphan-video-model"}`)

	assert.False(t, pinnedPresent)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "orphan-video-model")
	assert.Contains(t, recorder.Body.String(), "no task plugin can serve it")
}

// TestConfigDrivenVideoModelIgnoresDisabledChannel 覆盖禁用渠道：被禁用的渠道不能让
// 插件看起来可用，否则请求会被 pin 到一个永远选不到渠道的插件上。
func TestConfigDrivenVideoModelIgnoresDisabledChannel(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "disabled-video", configDrivenChannelType, "disabled-video-model", common.ChannelStatusManuallyDisabled)
	setVideoModelSettings(t, `[{"model":"disabled-video-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	_, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("disabled-channel-plugin", configDrivenChannelType, `["declared-model"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("disabled-channel-plugin")) })

	_, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"disabled-video-model"}`)

	assert.False(t, pinnedPresent)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "no task plugin can serve it")
}

// TestUnconfiguredModelStillRejected 是最重要的向后兼容回归：没有配置生视频的模型
// 即使有可用渠道，也必须继续落回原有行为（不进任务插件，由 Go relay 处理）。
func TestUnconfiguredModelStillRejected(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "unconfigured-video", configDrivenChannelType, "unconfigured-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[]`)

	_, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("unconfigured-plugin", configDrivenChannelType, `["declared-model"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("unconfigured-plugin")) })

	_, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"unconfigured-model"}`)

	// An unclaimed, unconfigured model must fall through to the Go relay
	// untouched — that is exactly today's behavior.
	assert.False(t, pinnedPresent)
	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "no task plugin can serve it")
}

// TestDeclaredModelBehaviorUnchanged 覆盖声明模型：模型仍在 meta.models 里时，配置
// 与否都不能改变既有路由结果。
func TestDeclaredModelBehaviorUnchanged(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "declared-video", configDrivenChannelType, "declared-model", common.ChannelStatusEnabled)

	plugin, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("declared-plugin", configDrivenChannelType, `["declared-model"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("declared-plugin")) })

	for _, testCase := range []struct {
		name    string
		payload string
	}{
		{name: "without configuration", payload: `[]`},
		{name: "with configuration", payload: `[{"model":"declared-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			setVideoModelSettings(t, testCase.payload)
			pinned, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"declared-model"}`)

			require.True(t, pinnedPresent, recorder.Body.String())
			assert.Same(t, plugin, pinned.Plugin)
			assert.Equal(t, "declared-model", pinned.Model)
		})
	}
}

// TestConfigDrivenVideoModelPicksOwningPluginOnly 覆盖插件归属校验：配置驱动的准入
// 必须同时校验渠道归属，不能让任意插件接受任意配置过的模型名。
func TestConfigDrivenVideoModelPicksOwningPluginOnly(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "owner-video", configDrivenChannelType, "shared-config-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[{"model":"shared-config-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	owner, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("config-owner", configDrivenChannelType, `["owner-declared"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("config-owner")) })
	stranger, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("config-stranger", configDrivenOtherChannelType, `["stranger-declared"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("config-stranger")) })

	generation := jsplugin.DefaultRegistry.Generation()
	assert.True(t, pluginServesConfiguredVideoModel(generation, owner, "shared-config-model"))
	assert.False(t, pluginServesConfiguredVideoModel(generation, stranger, "shared-config-model"),
		"a plugin that owns none of the model's channel types must not accept it")

	pinned, pinnedPresent, recorder := serveConfigDrivenRequest(t, `{"model":"shared-config-model"}`)
	require.True(t, pinnedPresent, recorder.Body.String())
	assert.Same(t, owner, pinned.Plugin)
	require.Len(t, pinned.Candidates, 1)
	assert.Same(t, owner, pinned.Candidates[0].Plugin)
}

// TestPluginServesConfiguredVideoModelGuards 覆盖归属判定的边界：未配置、已声明、
// 空名与 nil 插件都必须返回 false，保证调用方的既有拒绝路径不被绕过。
func TestPluginServesConfiguredVideoModelGuards(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "guard-video", configDrivenChannelType, "guard-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[{"model":"guard-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	plugin, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("guard-plugin", configDrivenChannelType, `["guard-declared"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("guard-plugin")) })
	generation := jsplugin.DefaultRegistry.Generation()

	assert.False(t, pluginServesConfiguredVideoModel(generation, plugin, "unconfigured-model"))
	assert.False(t, pluginServesConfiguredVideoModel(generation, plugin, ""))
	assert.False(t, pluginServesConfiguredVideoModel(generation, nil, "guard-model"))
	assert.False(t, pluginServesConfiguredVideoModel(nil, plugin, "guard-model"))
	// A model the plugin already declares needs no configuration-driven path.
	assert.False(t, pluginServesConfiguredVideoModel(generation, plugin, "guard-declared"))
	assert.True(t, pluginServesConfiguredVideoModel(generation, plugin, "guard-model"))
}

// TestGetEnabledChannelTypesForModelSkipsDisabledChannels 覆盖渠道类型反查：只返回
// 启用渠道的类型，并且结果去重后升序，便于日志与断言稳定。
func TestGetEnabledChannelTypesForModelSkipsDisabledChannels(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "enabled-a", configDrivenOtherChannelType, "multi-type-model", common.ChannelStatusEnabled)
	insertConfigDrivenChannel(t, "enabled-b", configDrivenChannelType, "multi-type-model", common.ChannelStatusEnabled)
	insertConfigDrivenChannel(t, "disabled-c", 62, "multi-type-model", common.ChannelStatusManuallyDisabled)

	assert.Equal(t,
		[]int{configDrivenChannelType, configDrivenOtherChannelType},
		model.GetEnabledChannelTypesForModel("multi-type-model"),
	)
	assert.Nil(t, model.GetEnabledChannelTypesForModel("absent-model"))
	assert.Nil(t, model.GetEnabledChannelTypesForModel("  "))
}

// TestConfigDrivenLegacySubmitAcceptsConfiguredModel 覆盖 legacy 提交入口：
// /v1/tasks/:key 上的模型校验必须同样接受配置驱动的模型，且不改写模型名。
func TestConfigDrivenLegacySubmitAcceptsConfiguredModel(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	insertConfigDrivenChannel(t, "legacy-video", configDrivenChannelType, "legacy-config-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[{"model":"legacy-config-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	_, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("legacy-config-plugin", configDrivenChannelType, `["legacy-declared"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("legacy-config-plugin")) })

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Params = gin.Params{{Key: "key", Value: "legacy-config-plugin"}}
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/tasks/legacy-config-plugin",
		strings.NewReader(`{"model":"legacy-config-model","prompt":"x"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	PrepareTaskPluginSubmit()(c)

	require.False(t, c.IsAborted(), recorder.Body.String())
	assert.Equal(t, "legacy-config-model", c.GetString("resolved_task_model"))
	assert.Equal(t, "legacy-config-plugin", c.GetString("expected_task_plugin_key"))
}

// TestConfigDrivenLegacySubmitRejectsForeignPlugin 覆盖 legacy 入口的归属校验：
// 不拥有其渠道类型的插件仍会被 legacy 入口放行到分发阶段，但渠道身份过滤器只允许
// 该插件自己声明的渠道类型，所以选渠道时必然落空 —— 这是既有语义，本次改造只保证
// 配置驱动的准入不会绕过它。
func TestConfigDrivenLegacySubmitRejectsForeignPlugin(t *testing.T) {
	setupConfigDrivenVideoDB(t)
	ownerChannel := insertConfigDrivenChannel(t, "legacy-owner", configDrivenChannelType, "legacy-foreign-model", common.ChannelStatusEnabled)
	setVideoModelSettings(t, `[{"model":"legacy-foreign-model","modes":[],"max_n":1,"video_modes":["text_to_video"]}]`)

	foreign, err := jsplugin.DefaultRegistry.Register(
		configDrivenPluginSource("legacy-foreign-plugin", configDrivenOtherChannelType, `["legacy-foreign-declared"]`),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister("legacy-foreign-plugin")) })

	generation := jsplugin.DefaultRegistry.Generation()
	// The ownership predicate itself must refuse the foreign plugin.
	assert.False(t, pluginServesConfiguredVideoModel(generation, foreign, "legacy-foreign-model"))

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Params = gin.Params{{Key: "key", Value: "legacy-foreign-plugin"}}
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/tasks/legacy-foreign-plugin",
		strings.NewReader(`{"model":"legacy-foreign-model","prompt":"x"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	PrepareTaskPluginSubmit()(c)

	// The model name must not be rewritten, and the channel identity filter must
	// be scoped to the foreign plugin's own channel types — which is what makes
	// channel selection fail for a plugin that does not own the model's channel.
	assert.Equal(t, "legacy-foreign-model", c.GetString("resolved_task_model"))
	filters := service.GetChannelConstraints(c).Filters
	require.Len(t, filters, 1)
	assert.Equal(t, dto.FilterTaskPluginIdentity, filters[0].Kind)
	assert.Equal(t, "legacy-foreign-plugin", filters[0].TaskPluginKey)
	assert.Equal(t, []int{configDrivenOtherChannelType}, filters[0].TaskPluginChannelTypes)
	assert.NotContains(t, filters[0].TaskPluginChannelTypes, ownerChannel.Type,
		"the owning channel type must not be admitted for a foreign plugin")

	// And the owning channel therefore cannot satisfy the filter.
	matches, kind := model.ChannelSatisfiesFilters(ownerChannel, "legacy-foreign-model", filters)
	assert.False(t, matches)
	assert.Equal(t, dto.FilterTaskPluginIdentity, kind)
}
