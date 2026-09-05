package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Both endpoints share the same response contract; refresh (POST) bypasses
// the TTL cache. An optional ?key_index=N query parameter selects which key
// of a multi-key channel to query with; it never mutates channel settings.
// Malformed values (non-numeric, negative, or out of range for the channel)
// are rejected with HTTP 400 before any upstream work.
func GetChannelQuotaUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid channel id"})
		return
	}
	opt, ok := parseQuotaQueryOption(c)
	if !ok {
		return
	}
	channel, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Range-check the override against the channel's key count so a
	// too-large index is an HTTP 400, not a 200 needs_configuration body.
	if opt.KeyIndex != nil {
		keyCount := 0
		if key := strings.TrimSpace(channel.Key); key != "" {
			keyCount = 1
			if channel.ChannelInfo.IsMultiKey {
				keyCount = len(channel.GetKeys())
			}
		}
		if *opt.KeyIndex >= keyCount {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "quota query key index out of bounds"})
			return
		}
	}
	result := service.QueryChannelQuotaWithOption(c.Request.Context(), channel, c.Request.Method == http.MethodPost, opt)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func GetQuotaQueryPresets(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": service.GetQuotaQueryPresets()})
}

func GetChannelQuotaQueryCapabilities(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	opt, ok := parseQuotaQueryOption(c)
	if !ok {
		return
	}
	config, err := service.GetQuotaQueryConfigWithOption(channel, opt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"channel_id": id, "preset_id": config.ResolvedPresetID, "status": config.Status, "query_implemented": config.QueryImplemented, "can_query": config.CanQuery, "missing_fields": config.MissingFields, "key_index": config.KeyIndex}})
}

func GetChannelQuotaQueryConfig(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	opt, ok := parseQuotaQueryOption(c)
	if !ok {
		return
	}
	config, err := service.GetQuotaQueryConfigWithOption(channel, opt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

// parseQuotaQueryOption extracts the optional non-mutating ?key_index=N
// parameter. It writes the HTTP 400 response and returns false for malformed
// (non-numeric or negative) values. Range validation against the channel's
// key count happens in service.GetQuotaQueryConfigWithOption.
func parseQuotaQueryOption(c *gin.Context) (service.QuotaQueryOption, bool) {
	opt := service.QuotaQueryOption{}
	raw := c.Query("key_index")
	if raw == "" {
		return opt, true
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid key_index"})
		return opt, false
	}
	opt.KeyIndex = &v
	return opt, true
}
