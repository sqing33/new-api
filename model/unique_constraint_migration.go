package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Columns whose models declare uniqueness with a standalone `uniqueIndex`
// instead of the legacy inline `unique` tag. Databases created by older
// versions still carry the inline UNIQUE constraint, which PostgreSQL
// auto-named <table>_<column>_key, while GORM v1.25's MigrateColumnUnique
// always drops such a constraint under NamingStrategy.UniqueName
// (uni_<table>_<column>). The name mismatch makes AutoMigrate abort with
// SQLSTATE 42704 and blocks startup, so the legacy constraint is renamed to
// the expected name first and the removal is handed back to AutoMigrate.
var legacyUniqueConstraintColumns = []legacyUniqueConstraintEntry{
	{model: &User{}, columns: []string{"access_token", "aff_code"}},
	{model: &PasskeyCredential{}, columns: []string{"credential_id", "user_id"}},
	{model: &Redemption{}, columns: []string{"key"}},
	{model: &CustomOAuthProvider{}, columns: []string{"slug"}},
	{model: &ToolInstallToken{}, columns: []string{"token_hash"}},
	{model: &ToolInstallTool{}, columns: []string{"slug"}},
	{model: &SubscriptionPreConsumeRecord{}, columns: []string{"request_id"}},
}

type legacyUniqueConstraintEntry struct {
	model   any
	columns []string
}

// migrateLegacyUniqueConstraintNames renames legacy PostgreSQL unique
// constraints to the names GORM expects before AutoMigrate runs. It is
// idempotent: columns already carrying the expected constraint name are left
// untouched, and models still declaring `unique` keep their constraints.
func migrateLegacyUniqueConstraintNames(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate legacy unique constraint names: database is nil")
	}
	if db.Dialector.Name() != "postgres" {
		// <table>_<column>_key 对 uni_<table>_<column> 的命名错位是 PostgreSQL
		// 的内联 UNIQUE 自动命名产物;其他方言的约束命名由各自 migrator 管理。
		return nil
	}

	for _, entry := range legacyUniqueConstraintColumns {
		statement := &gorm.Statement{DB: db}
		if err := statement.Parse(entry.model); err != nil {
			return fmt.Errorf("parse schema for legacy unique constraint migration: %w", err)
		}
		tableName := statement.Schema.Table
		if !db.Migrator().HasTable(entry.model) {
			continue
		}

		columns := make([]string, 0, len(entry.columns))
		for _, columnName := range entry.columns {
			field := statement.Schema.LookUpField(columnName)
			if field == nil {
				continue
			}
			if field.Unique {
				// 模型仍以 `unique` 标签声明约束时,GORM 不会尝试删除,旧名字无害。
				continue
			}
			columns = append(columns, field.DBName)
		}
		if len(columns) == 0 {
			continue
		}

		pending, err := anyLegacyUniqueConstraint(db, tableName, columns)
		if err != nil {
			return err
		}
		if !pending {
			continue
		}

		if err := db.Transaction(func(tx *gorm.DB) error {
			common.SysLog(fmt.Sprintf(
				"legacy unique constraint migration: acquiring ACCESS EXCLUSIVE lock on %s (brief, rename-only)",
				tableName,
			))
			if err := tx.Exec(
				"LOCK TABLE ? IN ACCESS EXCLUSIVE MODE",
				clause.Table{Name: tableName},
			).Error; err != nil {
				return fmt.Errorf("lock %s for legacy unique constraint migration: %w", tableName, err)
			}
			for _, columnName := range columns {
				if err := migrateLegacyUniqueConstraintForColumn(tx, tableName, columnName); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

// migrateLegacyUniqueConstraintForColumn renames (or, when the expected name
// is already taken on the same column, drops) the legacy-named unique
// constraints on one column. The caller must hold an exclusive table lock.
func migrateLegacyUniqueConstraintForColumn(tx *gorm.DB, tableName, columnName string) error {
	expectedName := tx.NamingStrategy.UniqueName(tableName, columnName)
	names, err := inspectSingleColumnUniqueConstraints(tx, tableName, columnName)
	if err != nil {
		return err
	}

	expectedTaken := false
	var legacyNames []string
	for _, name := range names {
		if name == expectedName {
			expectedTaken = true
		} else {
			legacyNames = append(legacyNames, name)
		}
	}

	for _, legacyName := range legacyNames {
		if expectedTaken {
			common.SysLog(fmt.Sprintf(
				"legacy unique constraint migration: dropping %q on %s.%s, %q already exists",
				legacyName, tableName, columnName, expectedName,
			))
			if err := tx.Exec(
				"ALTER TABLE ? DROP CONSTRAINT ?",
				clause.Table{Name: tableName},
				clause.Column{Name: legacyName},
			).Error; err != nil {
				return fmt.Errorf("drop legacy unique constraint %q on %s: %w", legacyName, tableName, err)
			}
			continue
		}
		common.SysLog(fmt.Sprintf(
			"legacy unique constraint migration: renaming %q to %q on %s.%s",
			legacyName, expectedName, tableName, columnName,
		))
		if err := tx.Exec(
			"ALTER TABLE ? RENAME CONSTRAINT ? TO ?",
			clause.Table{Name: tableName},
			clause.Column{Name: legacyName},
			clause.Column{Name: expectedName},
		).Error; err != nil {
			return fmt.Errorf("rename legacy unique constraint %q on %s: %w", legacyName, tableName, err)
		}
		expectedTaken = true
	}
	return nil
}

func inspectSingleColumnUniqueConstraints(db *gorm.DB, tableName, columnName string) ([]string, error) {
	var names []string
	if err := db.Raw(`
SELECT constraint_meta.conname
FROM pg_catalog.pg_constraint AS constraint_meta
WHERE constraint_meta.conrelid = to_regclass(?)
  AND constraint_meta.contype = 'u'
  AND cardinality(constraint_meta.conkey) = 1
  AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_meta
      WHERE attribute_meta.attrelid = constraint_meta.conrelid
        AND attribute_meta.attnum = constraint_meta.conkey[1]
        AND attribute_meta.attname = ?
  )
ORDER BY constraint_meta.conname`, tableName, columnName).Scan(&names).Error; err != nil {
		return nil, fmt.Errorf("inspect single column unique constraints on %s.%s: %w", tableName, columnName, err)
	}
	return names, nil
}

// anyLegacyUniqueConstraint reports whether any listed column still carries a
// unique constraint not named the way GORM expects. Uniqueness itself is never
// touched here; only the legacy names are.
func anyLegacyUniqueConstraint(db *gorm.DB, tableName string, columns []string) (bool, error) {
	for _, columnName := range columns {
		expectedName := db.NamingStrategy.UniqueName(tableName, columnName)
		names, err := inspectSingleColumnUniqueConstraints(db, tableName, columnName)
		if err != nil {
			return false, err
		}
		for _, name := range names {
			if name != expectedName {
				return true, nil
			}
		}
	}
	return false, nil
}
