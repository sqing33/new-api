package model

import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func legacyUniqueConstraintEntryModels() []any {
	models := make([]any, 0, len(legacyUniqueConstraintColumns))
	for _, entry := range legacyUniqueConstraintColumns {
		models = append(models, entry.model)
	}
	return models
}

func requireUniqueConstraintCount(t *testing.T, db *gorm.DB, tableName, constraintName string) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Raw(`
SELECT count(*)
FROM pg_catalog.pg_constraint
WHERE conrelid = to_regclass(?)
  AND contype = 'u'
  AND conname = ?`, tableName, constraintName).Scan(&count).Error)
	return count
}

func TestMigrateLegacyUniqueConstraintNamesSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	// PostgreSQL 专属迁移在其他方言上是 no-op,不得影响正常建表。
	require.NoError(t, migrateLegacyUniqueConstraintNames(db))
	require.NoError(t, db.AutoMigrate(legacyUniqueConstraintEntryModels()...))
}

func TestMigrateLegacyUniqueConstraintNamesPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })

	for _, entry := range legacyUniqueConstraintColumns {
		for _, columnName := range entry.columns {
			statement := &gorm.Statement{DB: db}
			require.NoError(t, statement.Parse(entry.model))
			tableName := statement.Schema.Table
			t.Run(tableName+"."+columnName, func(t *testing.T) {
				legacyConstraint := tableName + "_" + columnName + "_key"
				expectedConstraint := db.NamingStrategy.UniqueName(tableName, columnName)
				uniqueIndexName := db.NamingStrategy.IndexName(tableName, columnName)

				t.Cleanup(func() { _ = db.Migrator().DropTable(entry.model) })
				// 全新表:AutoMigrate 按当前模型生成独立 uniqueIndex,无任何约束。
				require.NoError(t, db.Migrator().DropTable(entry.model))
				require.NoError(t, db.AutoMigrate(entry.model))

				// 复原老版本状态:独立 uniqueIndex 被内联 UNIQUE 约束替代,
				// 且约束名是 PostgreSQL 的自动命名 <table>_<column>_key。
				require.NoError(t, db.Migrator().DropIndex(entry.model, uniqueIndexName))
				require.NoError(t, db.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: tableName},
					clause.Column{Name: legacyConstraint},
					clause.Column{Name: columnName},
				).Error)

				// 回归:不先改名的话,AutoMigrate 因 SQLSTATE 42704 直接失败。
				err := db.AutoMigrate(entry.model)
				require.Error(t, err)
				assert.True(t, strings.Contains(err.Error(), "42704"), "unexpected error: %v", err)

				require.NoError(t, migrateLegacyUniqueConstraintNames(db))
				require.EqualValues(t, 1, requireUniqueConstraintCount(t, db, tableName, expectedConstraint))
				require.EqualValues(t, 0, requireUniqueConstraintCount(t, db, tableName, legacyConstraint))

				// 改名后 AutoMigrate 正常完成,并按当前模型接管删除约束。
				require.NoError(t, db.AutoMigrate(entry.model))
				require.EqualValues(t, 0, requireUniqueConstraintCount(t, db, tableName, expectedConstraint))
				require.True(t, db.Migrator().HasIndex(entry.model, uniqueIndexName))

				// 幂等:再次执行不应有任何动作或报错。
				require.NoError(t, migrateLegacyUniqueConstraintNames(db))
				require.NoError(t, db.AutoMigrate(entry.model))
			})
		}
	}
}
