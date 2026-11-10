package model

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// TokenGroupNameMaxLength 是分组名的长度上限（按字符计，不是字节）。
const TokenGroupNameMaxLength = 32

var (
	// ErrTokenGroupNameEmpty 表示分组名为空。空串在令牌上是合法的「未分组」，
	// 但不能用来命名一个分组。
	ErrTokenGroupNameEmpty = errors.New("token group name is empty")
	// ErrTokenGroupNameTooLong 表示分组名超过 TokenGroupNameMaxLength 个字符。
	ErrTokenGroupNameTooLong = errors.New("token group name is too long")
	// ErrTokenGroupNameInvalid 表示分组名包含控制字符之类的非法字符。
	ErrTokenGroupNameInvalid = errors.New("token group name contains invalid characters")
	// ErrTokenGroupNameExists 表示同一用户下已经存在同名分组。
	ErrTokenGroupNameExists = errors.New("token group name already exists")
	// ErrTokenGroupNotFound 表示分组不存在或不属于当前用户。
	ErrTokenGroupNotFound = errors.New("token group not found")
)

// TokenGroup 是令牌的「组织分组」：用户给 API key 打的标签，用来按设备/工具归类。
//
// 它与 Token.Group（令牌分组 = 路由分组，决定 key 能用哪些渠道、计费倍率）完全无关。
//
// 目录独立于令牌存在：用户可以先建一个还没有任何令牌的空分组，之后再往里放 key。
// 令牌上保存的是分组「名字」而不是 id —— 于是「按分组排序」是对一个带索引的普通列
// 排序，SQL 路径与内存路径（并发维度）语义一致，三种数据库都不需要 JOIN，
// 也就避开了 JOIN 出来的 token_groups.id 覆盖 tokens.id 这类列名冲突。
type TokenGroup struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"index;uniqueIndex:uk_token_group_user_name"`
	Name        string `json:"name" gorm:"type:varchar(64);not null;uniqueIndex:uk_token_group_user_name"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint"`
}

// TokenGroupInfo 是分组列表的返回项：分组本身 + 该分组下的令牌数。
type TokenGroupInfo struct {
	Id    int    `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// NormalizeTokenGroupName 校验并清洗分组名。
// 空串表示「未分组」，是合法取值；调用方据此决定是否落库。
func NormalizeTokenGroupName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", nil
	}
	if utf8.RuneCountInString(trimmed) > TokenGroupNameMaxLength {
		return "", ErrTokenGroupNameTooLong
	}
	for _, r := range trimmed {
		if unicode.IsControl(r) {
			return "", ErrTokenGroupNameInvalid
		}
	}
	return trimmed, nil
}

// ListUserTokenGroups 返回用户的分组目录，附带每个分组下的令牌数。
// 空分组同样会出现在结果里（count = 0）。
func ListUserTokenGroups(userId int) ([]*TokenGroupInfo, error) {
	var groups []*TokenGroup
	if err := DB.Where("user_id = ?", userId).Order("name ASC").Find(&groups).Error; err != nil {
		return nil, err
	}

	type tokenGroupCount struct {
		Name  string
		Count int64
	}
	var counts []tokenGroupCount
	if err := DB.Model(&Token{}).
		Select("token_group AS name, COUNT(*) AS count").
		Where("user_id = ? AND token_group IS NOT NULL AND token_group <> ''", userId).
		Group("token_group").
		Scan(&counts).Error; err != nil {
		return nil, err
	}

	countByName := make(map[string]int64, len(counts))
	for _, item := range counts {
		countByName[item.Name] = item.Count
	}

	result := make([]*TokenGroupInfo, 0, len(groups))
	for _, group := range groups {
		result = append(result, &TokenGroupInfo{
			Id:    group.Id,
			Name:  group.Name,
			Count: countByName[group.Name],
		})
	}
	return result, nil
}

// EnsureUserTokenGroup 返回指定名字的分组，不存在时创建。
// 令牌保存时用它保证「正在使用的分组」一定在目录里。
func EnsureUserTokenGroup(userId int, name string) (*TokenGroup, error) {
	normalized, err := NormalizeTokenGroupName(name)
	if err != nil {
		return nil, err
	}
	if normalized == "" {
		return nil, nil
	}

	var group TokenGroup
	err = DB.Where("user_id = ? AND name = ?", userId, normalized).First(&group).Error
	if err == nil {
		return &group, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	now := common.GetTimestamp()
	group = TokenGroup{UserId: userId, Name: normalized, CreatedTime: now, UpdatedTime: now}
	if err := DB.Create(&group).Error; err != nil {
		// 并发创建同名分组时唯一索引会拦下来，重读一次即可。
		if readErr := DB.Where("user_id = ? AND name = ?", userId, normalized).First(&group).Error; readErr == nil {
			return &group, nil
		}
		return nil, err
	}
	return &group, nil
}

// CreateUserTokenGroup 新建一个分组。名字已存在时返回 ErrTokenGroupNameExists。
func CreateUserTokenGroup(userId int, name string) (*TokenGroup, error) {
	normalized, err := NormalizeTokenGroupName(name)
	if err != nil {
		return nil, err
	}
	if normalized == "" {
		return nil, ErrTokenGroupNameEmpty
	}

	var existing TokenGroup
	err = DB.Where("user_id = ? AND name = ?", userId, normalized).First(&existing).Error
	if err == nil {
		return nil, ErrTokenGroupNameExists
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	now := common.GetTimestamp()
	group := TokenGroup{UserId: userId, Name: normalized, CreatedTime: now, UpdatedTime: now}
	if err := DB.Create(&group).Error; err != nil {
		if readErr := DB.Where("user_id = ? AND name = ?", userId, normalized).First(&existing).Error; readErr == nil {
			return nil, ErrTokenGroupNameExists
		}
		return nil, err
	}
	return &group, nil
}

// RenameUserTokenGroup 重命名分组，并把该用户令牌上的分组名一起改掉。
// 目录行与令牌引用在同一个事务里更新，不会出现「目录改了、令牌没改」的中间态。
func RenameUserTokenGroup(userId int, groupId int, newName string) (*TokenGroup, error) {
	normalized, err := NormalizeTokenGroupName(newName)
	if err != nil {
		return nil, err
	}
	if normalized == "" {
		return nil, ErrTokenGroupNameEmpty
	}

	var renamed *TokenGroup
	err = DB.Transaction(func(tx *gorm.DB) error {
		var group TokenGroup
		if err := tx.Where("id = ? AND user_id = ?", groupId, userId).First(&group).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenGroupNotFound
			}
			return err
		}
		if group.Name == normalized {
			renamed = &group
			return nil
		}

		var conflict TokenGroup
		err := tx.Where("user_id = ? AND name = ?", userId, normalized).First(&conflict).Error
		if err == nil {
			return ErrTokenGroupNameExists
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		now := common.GetTimestamp()
		if err := tx.Model(&TokenGroup{}).Where("id = ? AND user_id = ?", groupId, userId).
			Updates(map[string]any{"name": normalized, "updated_time": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Token{}).Where("user_id = ? AND token_group = ?", userId, group.Name).
			Update("token_group", normalized).Error; err != nil {
			return err
		}
		group.Name = normalized
		group.UpdatedTime = now
		renamed = &group
		return nil
	})
	if err != nil {
		return nil, err
	}
	return renamed, nil
}

// DeleteUserTokenGroup 删除分组，并把该用户令牌上的分组引用清空（回到「未分组」）。
func DeleteUserTokenGroup(userId int, groupId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var group TokenGroup
		if err := tx.Where("id = ? AND user_id = ?", groupId, userId).First(&group).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenGroupNotFound
			}
			return err
		}
		if err := tx.Model(&Token{}).Where("user_id = ? AND token_group = ?", userId, group.Name).
			Update("token_group", "").Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", groupId, userId).Delete(&TokenGroup{}).Error
	})
}
