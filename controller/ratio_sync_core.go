package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
)

func newPricingHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:  10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	if common.TLSInsecureSkipVerify {
		transport.TLSClientConfig = common.InsecureTLSConfig
	}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}
		if strings.HasSuffix(host, "github.io") {
			if conn, err := dialer.DialContext(ctx, "tcp4", addr); err == nil {
				return conn, nil
			}
			return dialer.DialContext(ctx, "tcp6", addr)
		}
		return dialer.DialContext(ctx, network, addr)
	}
	return &http.Client{Transport: transport}
}

func fetchSingleUpstreamPricing(ctx context.Context, baseURL, endpoint string, channelID, timeout int) (map[string]any, error) {
	isOpenRouter := endpoint == "openrouter"

	var fullURL string
	if isOpenRouter {
		fullURL = baseURL + "/v1/models"
	} else if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		fullURL = endpoint
	} else {
		if endpoint == "" {
			endpoint = defaultEndpoint
		} else if !strings.HasPrefix(endpoint, "/") {
			endpoint = "/" + endpoint
		}
		fullURL = baseURL + endpoint
	}
	isModelsDev := isModelsDevAPIEndpoint(fullURL)

	fetchCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request failed: %w", err)
	}

	if isOpenRouter {
		if channelID == 0 {
			return nil, fmt.Errorf("OpenRouter requires a valid channel with API key")
		}
		dbCh, err := model.GetChannelById(channelID, true)
		if err != nil {
			return nil, fmt.Errorf("failed to get channel key: %w", err)
		}
		key, _, apiErr := dbCh.GetNextEnabledKey()
		if apiErr != nil {
			return nil, fmt.Errorf("failed to get enabled channel key: %w", apiErr)
		}
		if strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("no API key configured for this channel")
		}
		httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))
	}

	client := newPricingHTTPClient()
	var resp *http.Response
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		resp, lastErr = client.Do(httpReq)
		if lastErr == nil {
			break
		}
		time.Sleep(time.Duration(200*(1<<attempt)) * time.Millisecond)
	}
	if lastErr != nil {
		return nil, fmt.Errorf("http error: %w", lastErr)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 status: %s", resp.Status)
	}

	limited := io.LimitReader(resp.Body, maxRatioConfigBytes)
	bodyBytes, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read response failed: %w", err)
	}

	if isOpenRouter {
		return convertOpenRouterToRatioData(bytes.NewReader(bodyBytes))
	}

	if isModelsDev {
		return convertModelsDevToRatioData(bytes.NewReader(bodyBytes))
	}

	var body struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Message string          `json:"message"`
	}
	if err := common.DecodeJson(bytes.NewReader(bodyBytes), &body); err != nil {
		return nil, fmt.Errorf("json decode failed: %w", err)
	}
	if !body.Success {
		return nil, fmt.Errorf("upstream returned error: %s", body.Message)
	}

	var type1Data map[string]any
	if err := common.Unmarshal(body.Data, &type1Data); err == nil {
		for _, rt := range pricingSyncFields {
			if _, ok := type1Data[rt]; ok {
				return type1Data, nil
			}
		}
	}

	var pricingItems []struct {
		ModelName            string   `json:"model_name"`
		QuotaType            int      `json:"quota_type"`
		ModelRatio           float64  `json:"model_ratio"`
		ModelPrice           float64  `json:"model_price"`
		CompletionRatio      float64  `json:"completion_ratio"`
		CacheRatio           *float64 `json:"cache_ratio"`
		CreateCacheRatio     *float64 `json:"create_cache_ratio"`
		ImageRatio           *float64 `json:"image_ratio"`
		AudioRatio           *float64 `json:"audio_ratio"`
		AudioCompletionRatio *float64 `json:"audio_completion_ratio"`
		BillingMode          string   `json:"billing_mode"`
		BillingExpr          string   `json:"billing_expr"`
	}
	if err := common.Unmarshal(body.Data, &pricingItems); err != nil {
		return nil, fmt.Errorf("unrecognized data format: %w", err)
	}

	modelRatioMap := make(map[string]float64)
	completionRatioMap := make(map[string]float64)
	cacheRatioMap := make(map[string]float64)
	createCacheRatioMap := make(map[string]float64)
	imageRatioMap := make(map[string]float64)
	audioRatioMap := make(map[string]float64)
	audioCompletionRatioMap := make(map[string]float64)
	modelPriceMap := make(map[string]float64)
	billingModeMap := make(map[string]string)
	billingExprMap := make(map[string]string)

	for _, item := range pricingItems {
		if item.ModelName == "" {
			continue
		}
		if item.BillingMode == billing_setting.BillingModeTieredExpr && strings.TrimSpace(item.BillingExpr) != "" {
			billingModeMap[item.ModelName] = billing_setting.BillingModeTieredExpr
			billingExprMap[item.ModelName] = item.BillingExpr
		}
		if item.QuotaType == 1 {
			modelPriceMap[item.ModelName] = item.ModelPrice
		} else {
			modelRatioMap[item.ModelName] = item.ModelRatio
			completionRatioMap[item.ModelName] = item.CompletionRatio
		}
		if item.CacheRatio != nil {
			cacheRatioMap[item.ModelName] = *item.CacheRatio
		}
		if item.CreateCacheRatio != nil {
			createCacheRatioMap[item.ModelName] = *item.CreateCacheRatio
		}
		if item.ImageRatio != nil {
			imageRatioMap[item.ModelName] = *item.ImageRatio
		}
		if item.AudioRatio != nil {
			audioRatioMap[item.ModelName] = *item.AudioRatio
		}
		if item.AudioCompletionRatio != nil {
			audioCompletionRatioMap[item.ModelName] = *item.AudioCompletionRatio
		}
	}

	converted := make(map[string]any)
	if len(modelRatioMap) > 0 {
		ratioAny := make(map[string]any, len(modelRatioMap))
		for k, v := range modelRatioMap {
			ratioAny[k] = v
		}
		converted["model_ratio"] = ratioAny
	}
	if len(completionRatioMap) > 0 {
		compAny := make(map[string]any, len(completionRatioMap))
		for k, v := range completionRatioMap {
			compAny[k] = v
		}
		converted["completion_ratio"] = compAny
	}
	if len(cacheRatioMap) > 0 {
		converted["cache_ratio"] = valueMap(cacheRatioMap)
	}
	if len(createCacheRatioMap) > 0 {
		converted["create_cache_ratio"] = valueMap(createCacheRatioMap)
	}
	if len(imageRatioMap) > 0 {
		converted["image_ratio"] = valueMap(imageRatioMap)
	}
	if len(audioRatioMap) > 0 {
		converted["audio_ratio"] = valueMap(audioRatioMap)
	}
	if len(audioCompletionRatioMap) > 0 {
		converted["audio_completion_ratio"] = valueMap(audioCompletionRatioMap)
	}
	if len(modelPriceMap) > 0 {
		priceAny := make(map[string]any, len(modelPriceMap))
		for k, v := range modelPriceMap {
			priceAny[k] = v
		}
		converted["model_price"] = priceAny
	}
	if len(billingModeMap) > 0 {
		converted[billing_setting.BillingModeField] = valueMap(billingModeMap)
	}
	if len(billingExprMap) > 0 {
		converted[billing_setting.BillingExprField] = valueMap(billingExprMap)
	}

	return converted, nil
}
