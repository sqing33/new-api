package router

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Session self-service routes are the only way a user can inspect and revoke
// their own browser Sessions, so losing their registration would silently make
// the documented recovery path unreachable (404) again.
func TestUserSessionRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	require.NotPanics(t, func() {
		SetApiRouter(engine)
	})

	registered := make(map[string]bool)
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{
		http.MethodGet + " /api/user/sessions",
		http.MethodDelete + " /api/user/sessions/:sid",
		http.MethodPost + " /api/user/sessions/revoke-others",
	} {
		assert.True(t, registered[route], "route %s must stay registered", route)
	}
}
