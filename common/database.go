package common

import "strings"

type DatabaseType string

const (
	DatabaseTypeMySQL      DatabaseType = "mysql"
	DatabaseTypeSQLite     DatabaseType = "sqlite"
	DatabaseTypePostgreSQL DatabaseType = "postgres"
	DatabaseTypeClickHouse DatabaseType = "clickhouse"
)

var mainDatabaseType = DatabaseTypeSQLite
var logDatabaseType = DatabaseTypeSQLite

func MainDatabaseType() DatabaseType {
	return mainDatabaseType
}

func LogDatabaseType() DatabaseType {
	return logDatabaseType
}

func SetMainDatabaseType(databaseType DatabaseType) {
	mainDatabaseType = databaseType
}

func SetLogDatabaseType(databaseType DatabaseType) {
	logDatabaseType = databaseType
}

func SetDatabaseTypes(mainType DatabaseType, logType DatabaseType) {
	mainDatabaseType = mainType
	logDatabaseType = logType
}

func UsingMainDatabase(databaseType DatabaseType) bool {
	return mainDatabaseType == databaseType
}

func UsingLogDatabase(databaseType DatabaseType) bool {
	return logDatabaseType == databaseType
}

// SQLitePath is the DSN for the default SQLite database. It uses WAL journal
// mode so readers are never blocked by the single writer, plus a 30s busy
// timeout for writers to queue.
//
// Two details are non-obvious and both are required for concurrent correctness:
//
//  1. The busy timeout must be passed as a `_pragma=busy_timeout(30000)` DSN
//     parameter. The pure-Go driver (modernc.org/sqlite, used through
//     github.com/glebarez/sqlite) silently ignores the plain `_busy_timeout=`
//     form, so without this the effective timeout stays at SQLite's 5s default
//     and concurrent writes surface as "database is locked" (see #6805).
//
//  2. `_txlock=immediate` (BEGIN IMMEDIATE) must be enabled. Without it, a
//     transaction that first SELECTs (establishing a read snapshot) and then
//     writes can hit SQLITE_BUSY_SNAPSHOT when another connection commits in
//     between; the busy handler does not cover that case, so the write fails
//     instantly no matter the timeout. BEGIN IMMEDIATE takes the write lock up
//     front, so writers serialize through the busy timeout instead of dying on
//     a stale snapshot. Autocommit SELECTs stay concurrent because WAL keeps
//     readers unlocked.
var SQLitePath = "one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"

// requiredSQLitePragmas 是 SQLite DSN 必须包含的 pragma/txlock 段。
// 任何缺这些的 DSN 在 #6805 描述的并发写场景会复现 "database is locked"。
// 见 SQLitePath 上方注释。
var requiredSQLitePragmas = []string{
	"_pragma=busy_timeout(30000)",
	"_pragma=journal_mode(WAL)",
	"_txlock=immediate",
}

// NormalizeSQLiteDSN 把缺失的 requiredSQLitePragmas 强制注入 DSN。已经手动设
// 过的同名段不被覆盖(让运维能调 busy_timeout 之类)。
// 接收 "path" 或 "path?k=v&k=v" 两种形式。
func NormalizeSQLiteDSN(dsn string) string {
	split := strings.SplitN(dsn, "?", 2)
	path := split[0]
	query := ""
	if len(split) == 2 {
		query = split[1]
	}
	pairs := []string{}
	if query != "" {
		for _, kv := range strings.Split(query, "&") {
			if kv == "" {
				continue
			}
			pairs = append(pairs, kv)
		}
	}
	for _, required := range requiredSQLitePragmas {
		prefix := strings.SplitN(required, "=", 2)[0] + "="
		found := false
		for _, existing := range pairs {
			if strings.HasPrefix(existing, prefix) {
				found = true
				break
			}
		}
		if !found {
			pairs = append(pairs, required)
		}
	}
	return path + "?" + strings.Join(pairs, "&")
}
