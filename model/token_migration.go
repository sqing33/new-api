package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	tokenKeyIndex              = "idx_tokens_key"
	postgresTokenKeyConstraint = "tokens_key_key"
	gormTokenKeyConstraint     = "uni_tokens_key"
)

type tokenKeyUniqueConstraint struct {
	Name       string `gorm:"column:constraint_name"`
	Definition string `gorm:"column:constraint_definition"`
	Deferrable bool   `gorm:"column:is_deferrable"`
	Validated  bool   `gorm:"column:is_validated"`
}

type tokenKeyIndexState struct {
	exists          bool
	definitionValid bool
	standaloneValid bool
}

func inspectTokenKeyUniqueConstraints(db *gorm.DB, tableName string) ([]tokenKeyUniqueConstraint, error) {
	var constraints []tokenKeyUniqueConstraint
	if err := db.Raw(`
SELECT constraint_meta.conname AS constraint_name,
       pg_get_constraintdef(constraint_meta.oid) AS constraint_definition,
       constraint_meta.condeferrable AS is_deferrable,
       constraint_meta.convalidated AS is_validated
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
ORDER BY constraint_meta.conname`, tableName, "key").Scan(&constraints).Error; err != nil {
		return nil, fmt.Errorf("inspect token key unique constraints: %w", err)
	}
	return constraints, nil
}

func validateTokenKeyUniqueConstraints(constraints []tokenKeyUniqueConstraint) error {
	for _, constraint := range constraints {
		switch constraint.Name {
		case tokenKeyIndex, postgresTokenKeyConstraint, gormTokenKeyConstraint:
		default:
			return fmt.Errorf(
				"tokens.key has unsupported unique constraint %q with definition %q",
				constraint.Name,
				constraint.Definition,
			)
		}
		if constraint.Deferrable || !constraint.Validated || strings.Contains(strings.ToUpper(constraint.Definition), "NULLS NOT DISTINCT") {
			return fmt.Errorf(
				"tokens.key unique constraint %q has unsupported definition %q",
				constraint.Name,
				constraint.Definition,
			)
		}
	}
	return nil
}

func inspectTokenKeyIndex(db *gorm.DB, tableName string) (tokenKeyIndexState, error) {
	var state struct {
		Exists          bool `gorm:"column:index_exists"`
		DefinitionValid bool `gorm:"column:definition_valid"`
		StandaloneValid bool `gorm:"column:standalone_valid"`
	}
	if err := db.Raw(`
SELECT count(*) > 0 AS index_exists,
       COALESCE(bool_or(
           index_meta.indisunique
           AND index_meta.indisvalid
           AND index_meta.indisready
           AND NOT index_meta.indisprimary
           AND index_meta.indpred IS NULL
           AND index_meta.indexprs IS NULL
           AND index_meta.indnatts = 1
           AND attribute_meta.attname = ?
       ), false) AS definition_valid,
       COALESCE(bool_or(
           index_meta.indisunique
           AND index_meta.indisvalid
           AND index_meta.indisready
           AND NOT index_meta.indisprimary
           AND index_meta.indpred IS NULL
           AND index_meta.indexprs IS NULL
           AND index_meta.indnatts = 1
           AND attribute_meta.attname = ?
           AND NOT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_constraint AS constraint_meta
               WHERE constraint_meta.conindid = index_meta.indexrelid
           )
       ), false) AS standalone_valid
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
LEFT JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_meta.indrelid = to_regclass(?)
  AND index_class.relname = ?`, "key", "key", tableName, tokenKeyIndex).Scan(&state).Error; err != nil {
		return tokenKeyIndexState{}, fmt.Errorf("inspect token key unique index: %w", err)
	}
	return tokenKeyIndexState{
		exists:          state.Exists,
		definitionValid: state.DefinitionValid,
		standaloneValid: state.StandaloneValid,
	}, nil
}

// migrateTokenKeyUniqueness converts known PostgreSQL UNIQUE constraints left
// on tokens.key into the standalone uniqueIndex represented by the current
// model. Unknown constraint names are reported without modifying the schema.
func migrateTokenKeyUniqueness(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate token key uniqueness: database is nil")
	}
	if db.Dialector.Name() != "postgres" {
		// MySQL/SQLite 由 dropLegacyTokenKeyIndexesIfPresent 走"只删已知 legacy 名"语义
		return dropLegacyTokenKeyIndexesIfPresent(db)
	}

	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(&Token{}); err != nil {
		return fmt.Errorf("parse token schema: %w", err)
	}
	tableName := statement.Schema.Table
	constraints, err := inspectTokenKeyUniqueConstraints(db, tableName)
	if err != nil {
		return err
	}
	if len(constraints) == 0 {
		return nil
	}
	if err := validateTokenKeyUniqueConstraints(constraints); err != nil {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		migrator := tx.Migrator()
		if !migrator.HasTable(&Token{}) {
			return nil
		}

		if err := tx.Exec(
			"LOCK TABLE ? IN ACCESS EXCLUSIVE MODE",
			clause.Table{Name: tableName},
		).Error; err != nil {
			return fmt.Errorf("lock tokens for key uniqueness migration: %w", err)
		}

		constraints, err := inspectTokenKeyUniqueConstraints(tx, tableName)
		if err != nil {
			return err
		}
		if len(constraints) == 0 {
			return nil
		}
		if err := validateTokenKeyUniqueConstraints(constraints); err != nil {
			return err
		}

		targetIndex, err := inspectTokenKeyIndex(tx, tableName)
		if err != nil {
			return err
		}
		if targetIndex.exists && !targetIndex.definitionValid {
			return fmt.Errorf("token key index %q has an unexpected definition", tokenKeyIndex)
		}

		for _, constraint := range constraints {
			if err := migrator.DropConstraint(&Token{}, constraint.Name); err != nil {
				return fmt.Errorf("drop token key unique constraint %q: %w", constraint.Name, err)
			}
		}

		targetIndex, err = inspectTokenKeyIndex(tx, tableName)
		if err != nil {
			return err
		}
		if !targetIndex.exists {
			if err := migrator.CreateIndex(&Token{}, tokenKeyIndex); err != nil {
				return fmt.Errorf("create token key unique index: %w", err)
			}
			targetIndex, err = inspectTokenKeyIndex(tx, tableName)
			if err != nil {
				return err
			}
		}
		if !targetIndex.standaloneValid {
			return fmt.Errorf("token key index %q has an unexpected definition", tokenKeyIndex)
		}

		remainingConstraints, err := inspectTokenKeyUniqueConstraints(tx, tableName)
		if err != nil {
			return err
		}
		if len(remainingConstraints) != 0 {
			return fmt.Errorf("tokens.key still has unique constraints after migration")
		}
		return nil
	})
}

// legacyTokenKeyConstraintCandidates 是 token_migration.go 已知的所有
// pre-merge 唯一约束 / 唯一索引名。MySQL/SQLite 路径只动这些,绝不误删
// 业务自建 unique 约束。
var legacyTokenKeyConstraintCandidates = []string{
	tokenKeyIndex,             // idx_tokens_key
	gormTokenKeyConstraint,    // uni_tokens_key
	postgresTokenKeyConstraint, // tokens_key_key(不应在 MySQL/SQLite 出现,但 drop 容错)
}

// dropLegacyTokenKeyIndexesIfPresent 在 MySQL/SQLite 上对 known legacy 名做
// best-effort drop(已存在就 drop,不存在就跳过,任何错误都返回,留给 AutoMigrate
// 接管新 uniqueIndex 重建)。
func dropLegacyTokenKeyIndexesIfPresent(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("drop legacy token key indexes: database is nil")
	}
	if !db.Migrator().HasTable(&Token{}) {
		return nil
	}
	migrator := db.Migrator()
	for _, name := range legacyTokenKeyConstraintCandidates {
		exists, err := hasIndexByName(db, "tokens", name)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		common.SysLog(fmt.Sprintf("dropping legacy tokens key index %q (%s)", name, db.Dialector.Name()))
		if err := migrator.DropIndex(&Token{}, name); err != nil {
			return fmt.Errorf("drop legacy tokens key index %q: %w", name, err)
		}
	}
	return nil
}

// hasIndexByName 方言元数据查表上是否存在某索引名。
func hasIndexByName(db *gorm.DB, table, indexName string) (bool, error) {
	switch db.Dialector.Name() {
	case "mysql":
		var count int64
		if err := db.Raw(
			`SELECT COUNT(*) FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
			table, indexName,
		).Scan(&count).Error; err != nil {
			return false, fmt.Errorf("inspect %s index: %w", table, err)
		}
		return count > 0, nil
	case "sqlite":
		var rows []struct {
			Name string `gorm:"column:name"`
		}
		if err := db.Raw("PRAGMA index_list(\"" + table + "\")").Scan(&rows).Error; err != nil {
			return false, fmt.Errorf("inspect %s index: %w", table, err)
		}
		for _, r := range rows {
			if r.Name == indexName {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, nil
	}
}
