package middleware

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	config := cors.DefaultConfig()
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}

	// AllowAllOrigins=true 与 AllowCredentials=true 同时开启会被浏览器拒绝
	// (W3C CORS spec),且任何第三方站点都能拿到带 cookie 的跨源请求。
	// 取安全策略:
	//   - 配置了 system_setting.ServerAddress 显式 origin:用白名单 + 允许凭据
	//   - 留空(ServerAddress = ""):保留 AllowAllOrigins,但禁掉 AllowCredentials。
	//     Authorization header 仍可跨源(浏览器在没凭据时不会发 cookie),所以
	//     API token 仍可用,但 cookie 形式登录态被锁在前端同源。
	if origins := trustedCORSOrigins(); len(origins) > 0 {
		config.AllowOrigins = origins
		config.AllowCredentials = true
	} else {
		config.AllowAllOrigins = true
		config.AllowCredentials = false
	}
	return cors.New(config)
}

// trustedCORSOrigins 从 system_setting.ServerAddress 派生白名单 origin。
// 同时加上 localhost 常见端口,方便本机调试。
func trustedCORSOrigins() []string {
	var origins []string
	if addr := strings.TrimSpace(system_setting.ServerAddress); addr != "" {
		if !strings.Contains(addr, "://") {
			addr = "http://" + addr
		}
		addr = strings.TrimRight(addr, "/")
		origins = append(origins, addr)
		// 同一个 origin 加 https 兜底(运维常配 http 但走 https 代理)
		if strings.HasPrefix(addr, "http://") {
			origins = append(origins, "https://"+strings.TrimPrefix(addr, "http://"))
		}
	}
	return origins
}

func Version() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-New-Api-Version", common.Version)
		c.Next()
	}
}
