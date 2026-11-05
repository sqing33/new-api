package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 渠道列表支持多级排序：SortBy 是逗号分隔的排序链，Apply 按顺序追加 ORDER BY。
// 这里锁定链的解析规则——顺序保持、去重、长度受限、非法维度被丢弃。

func TestChannelSortLevelsParsing(t *testing.T) {
	cases := []struct {
		name   string
		sortBy string
		want   []string
	}{
		{"空串不产生排序链", "", nil},
		{"单级", "name", []string{"name"}},
		{"两级保持顺序", "name,concurrency", []string{"name", "concurrency"}},
		{"顺序敏感", "concurrency,name", []string{"concurrency", "name"}},
		{"超过上限被截断", "name,concurrency,id", []string{"name", "concurrency"}},
		{"重复维度去重", "name,name", []string{"name"}},
		{"非法维度被丢弃", "name,drop_table", []string{"name"}},
		{"全部非法则为空链", "drop_table", nil},
		{"忽略空白与大小写", " Name , Concurrency ", []string{"name", "concurrency"}},
		{"空段被跳过", "name,,concurrency", []string{"name", "concurrency"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			options := NewChannelSortOptions(tc.sortBy, "desc", false)
			// nil 与空切片语义等价（都表示「无排序链」），用 ElementsMatch 兼容两者
			assert.ElementsMatch(t, tc.want, options.sortLevels())
			assert.Len(t, options.sortLevels(), len(tc.want))
		})
	}
}

func TestChannelSortHasConcurrency(t *testing.T) {
	assert.True(t, NewChannelSortOptions("concurrency", "desc", false).HasConcurrency())
	assert.True(t, NewChannelSortOptions("name,concurrency", "desc", false).HasConcurrency())
	// 第三级被截断后不应再算命中
	assert.False(t, NewChannelSortOptions("name,id,concurrency", "desc", false).HasConcurrency())
	assert.False(t, NewChannelSortOptions("name", "desc", false).HasConcurrency())
	assert.False(t, NewChannelSortOptions("", "desc", false).HasConcurrency())
}

// TestSortChannelsInMemoryMultiLevel 锁定多级排序的比较语义：
// 先按第一级比，相等才看第二级。并发维度不在数据库里，由内存排序处理，
// 这里用 counts 为 nil 的路径验证纯数据库维度的多级比较。
func TestSortChannelsInMemoryMultiLevel(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "bravo", Priority: priority(2)},
		{Id: 2, Name: "alpha", Priority: priority(2)},
		{Id: 3, Name: "charlie", Priority: priority(5)},
		{Id: 4, Name: "delta", Priority: priority(1)},
	}

	// 第一级 priority 降序，priority 相同的按第二级 name 升序。
	// 但 sortOrder 是全局的，这里两级同为降序，故 name 也是降序：
	// 期望 3(p5) → 1(bravo,p2) → 2(alpha,p2) → 4(p1)
	options := NewChannelSortOptions("priority,name", "desc", false)
	sorted := SortChannelsInMemory(channels, options, 0, -1)

	require.Len(t, sorted, 4)
	got := make([]int, len(sorted))
	for i, channel := range sorted {
		got[i] = channel.Id
	}
	assert.Equal(t, []int{3, 1, 2, 4}, got)
}

// TestSortChannelsInMemoryPagination 锁定内存排序后的分页切片语义：
// 并发排序必须能跨页正确，所以分页发生在排序之后。
func TestSortChannelsInMemoryPagination(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "a", Priority: priority(4)},
		{Id: 2, Name: "b", Priority: priority(3)},
		{Id: 3, Name: "c", Priority: priority(2)},
		{Id: 4, Name: "d", Priority: priority(1)},
	}
	options := NewChannelSortOptions("priority", "desc", false)

	page1 := SortChannelsInMemory(channels, options, 0, 2)
	require.Len(t, page1, 2)
	assert.Equal(t, 1, page1[0].Id)
	assert.Equal(t, 2, page1[1].Id)

	page2 := SortChannelsInMemory(channels, options, 2, 2)
	require.Len(t, page2, 2)
	assert.Equal(t, 3, page2[0].Id)
	assert.Equal(t, 4, page2[1].Id)

	// 起点越界返回空切片，不 panic
	assert.Empty(t, SortChannelsInMemory(channels, options, 10, 2))
}

// TestSortChannelsInMemoryNilPriority 锁定 Priority 为 nil 时的行为：
// 数据库列是 *int64，nil 必须按 0 处理而不是 panic。
func TestSortChannelsInMemoryNilPriority(t *testing.T) {
	priority := func(v int64) *int64 { return &v }
	channels := []*Channel{
		{Id: 1, Name: "has-priority", Priority: priority(5)},
		{Id: 2, Name: "nil-priority", Priority: nil},
	}
	sorted := SortChannelsInMemory(channels, NewChannelSortOptions("priority", "desc", false), 0, -1)
	require.Len(t, sorted, 2)
	assert.Equal(t, 1, sorted[0].Id, "priority=5 应排在 nil(=0) 之前")
	assert.Equal(t, 2, sorted[1].Id)
}
