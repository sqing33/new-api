package i18n

// Message keys of i18n/locales/*.yaml, for text the backend translates itself:
// errors returned to AI clients, emails and notifications. Web console messages
// are not listed here; the web console translates them (see common.Message).

// ability messages
const (
	MsgAbilityDbCorrupted   = "ability.db_corrupted"
	MsgAbilityRepairRunning = "ability.repair_running"
)

// auth messages
const (
	MsgAuthAccessTokenInvalid     = "auth.access_token_invalid"
	MsgAuthChannelSelectForbidden = "auth.channel_select_forbidden"
	MsgAuthClientIPUnresolved     = "auth.client_ip_unresolved"
	MsgAuthInsufficientPrivilege  = "auth.insufficient_privilege"
	MsgAuthNotLoggedIn            = "auth.not_logged_in"
	MsgAuthTokenGroupDeprecated   = "auth.token_group_deprecated"
	MsgAuthTokenGroupForbidden    = "auth.token_group_forbidden"
	MsgAuthTokenIPNotAllowed      = "auth.token_ip_not_allowed"
	MsgAuthUserBanned             = "auth.user_banned"
	MsgAuthUserIdFormatError      = "auth.user_id_format_error"
	MsgAuthUserIdMismatch         = "auth.user_id_mismatch"
	MsgAuthUserIdNotProvided      = "auth.user_id_not_provided"
	MsgAuthUserInfoInvalid        = "auth.user_info_invalid"
)

// channel messages
const (
	MsgChannelGetAvailableFailed            = "channel.get_available_failed"
	MsgChannelGetKeyFailed                  = "channel.get_key_failed"
	MsgChannelGetListFailed                 = "channel.get_list_failed"
	MsgChannelGetOllamaFailed               = "channel.get_ollama_failed"
	MsgChannelGetTagsFailed                 = "channel.get_tags_failed"
	MsgChannelIdFormatError                 = "channel.id_format_error"
	MsgChannelNoAvailableKey                = "channel.no_available_key"
	MsgChannelNoValidUpstream               = "channel.no_valid_upstream"
	MsgChannelNotExists                     = "channel.not_exists"
	MsgChannelNotifyDisabledContent         = "channel.notify_disabled_content"
	MsgChannelNotifyDisabledSubject         = "channel.notify_disabled_subject"
	MsgChannelNotifyEnabledContent          = "channel.notify_enabled_content"
	MsgChannelNotifyEnabledSubject          = "channel.notify_enabled_subject"
	MsgChannelQueryFailed                   = "channel.query_failed"
	MsgChannelResponseTimeExceeded          = "channel.response_time_exceeded"
	MsgChannelTestCompletedContent          = "channel.test_completed_content"
	MsgChannelTestCompletedSubject          = "channel.test_completed_subject"
	MsgChannelUpstreamSaturated             = "channel.upstream_saturated"
	MsgChannelUpstreamUpdateAddedModels     = "channel.upstream_update_added_models"
	MsgChannelUpstreamUpdateChangedChannels = "channel.upstream_update_changed_channels"
	MsgChannelUpstreamUpdateFailedChannels  = "channel.upstream_update_failed_channels"
	MsgChannelUpstreamUpdateMoreChannels    = "channel.upstream_update_more_channels"
	MsgChannelUpstreamUpdateMoreOmitted     = "channel.upstream_update_more_omitted"
	MsgChannelUpstreamUpdateNotifySubject   = "channel.upstream_update_notify_subject"
	MsgChannelUpstreamUpdateRemovedModels   = "channel.upstream_update_removed_models"
	MsgChannelUpstreamUpdateSummary         = "channel.upstream_update_summary"
)

// checkin messages
const (
	MsgCheckinAlreadyToday = "checkin.already_today"
	MsgCheckinDisabled     = "checkin.disabled"
	MsgCheckinFailed       = "checkin.failed"
	MsgCheckinQuotaFailed  = "checkin.quota_failed"
)

// common messages
const (
	MsgAlreadyExists     = "common.already_exists"
	MsgBatchTooMany      = "common.batch_too_many"
	MsgCreateFailed      = "common.create_failed"
	MsgCreateSuccess     = "common.create_success"
	MsgDatabaseError     = "common.database_error"
	MsgDeleteFailed      = "common.delete_failed"
	MsgDeleteSuccess     = "common.delete_success"
	MsgFeatureDisabled   = "common.feature_disabled"
	MsgForbidden         = "common.forbidden"
	MsgGenerateFailed    = "common.generate_failed"
	MsgIdEmpty           = "common.id_empty"
	MsgInvalidId         = "common.invalid_id"
	MsgInvalidInput      = "common.invalid_input"
	MsgInvalidParams     = "common.invalid_params"
	MsgNameCannotBeEmpty = "common.name_cannot_be_empty"
	MsgNotFound          = "common.not_found"
	MsgOperationFailed   = "common.operation_failed"
	MsgOperationSuccess  = "common.operation_success"
	MsgRetryLater        = "common.retry_later"
	MsgUnauthorized      = "common.unauthorized"
	MsgUpdateFailed      = "common.update_failed"
	MsgUpdateSuccess     = "common.update_success"
	MsgUuidDuplicate     = "common.uuid_duplicate"
)

// custom_oauth messages
const (
	MsgCustomOAuthBindingNotFound   = "custom_oauth.binding_not_found"
	MsgCustomOAuthHasBindings       = "custom_oauth.has_bindings"
	MsgCustomOAuthNameEmpty         = "custom_oauth.name_empty"
	MsgCustomOAuthNotFound          = "custom_oauth.not_found"
	MsgCustomOAuthProviderIdInvalid = "custom_oauth.provider_id_field_invalid"
	MsgCustomOAuthSlugEmpty         = "custom_oauth.slug_empty"
	MsgCustomOAuthSlugExists        = "custom_oauth.slug_exists"
)

// deployment messages
const (
	MsgDeploymentApiKeyRequired = "deployment.api_key_required"
	MsgDeploymentContainerIdReq = "deployment.container_id_required"
	MsgDeploymentHardwareIdReq  = "deployment.hardware_id_required"
	MsgDeploymentHardwareInvId  = "deployment.hardware_invalid_id"
	MsgDeploymentIdRequired     = "deployment.id_required"
	MsgDeploymentInvalidPayload = "deployment.invalid_payload"
	MsgDeploymentNameEmpty      = "deployment.name_empty"
	MsgDeploymentNameTaken      = "deployment.name_taken"
	MsgDeploymentNotEnabled     = "deployment.not_enabled"
	MsgDeploymentNotFound       = "deployment.not_found"
)

// distributor messages
const (
	MsgDistributorAffinityChannelDisabled      = "distributor.affinity_channel_disabled"
	MsgDistributorChannelDisabled              = "distributor.channel_disabled"
	MsgDistributorGetChannelFailed             = "distributor.get_channel_failed"
	MsgDistributorGroupAccessDenied            = "distributor.group_access_denied"
	MsgDistributorInvalidChannelId             = "distributor.invalid_channel_id"
	MsgDistributorInvalidMidjourney            = "distributor.invalid_midjourney_request"
	MsgDistributorInvalidParseModel            = "distributor.invalid_request_parse_model"
	MsgDistributorInvalidPlayground            = "distributor.invalid_playground_request"
	MsgDistributorInvalidRequest               = "distributor.invalid_request"
	MsgDistributorModelNameRequired            = "distributor.model_name_required"
	MsgDistributorNoAvailableChannel           = "distributor.no_available_channel"
	MsgDistributorNoAvailableChannelTaskPlugin = "distributor.no_available_channel_task_plugin"
	MsgDistributorTokenModelForbidden          = "distributor.token_model_forbidden"
	MsgDistributorTokenNoModelAccess           = "distributor.token_no_model_access"
)

// email messages
const (
	MsgEmailBindingCode                  = "email.binding.code"
	MsgEmailBindingNewIntro              = "email.binding.new_intro"
	MsgEmailBindingNewValidity           = "email.binding.new_validity"
	MsgEmailBindingOldIntro              = "email.binding.old_intro"
	MsgEmailBindingOldValidity           = "email.binding.old_validity"
	MsgEmailBindingSubject               = "email.binding.subject"
	MsgEmailPasswordResetGreeting        = "email.password_reset.greeting"
	MsgEmailPasswordResetLink            = "email.password_reset.link"
	MsgEmailPasswordResetLinkFallback    = "email.password_reset.link_fallback"
	MsgEmailPasswordResetSubject         = "email.password_reset.subject"
	MsgEmailPasswordResetValidity        = "email.password_reset.validity"
	MsgEmailSecurityNoticeAdvice         = "email.security_notice.advice"
	MsgEmailSecurityNoticeChanged        = "email.security_notice.changed"
	MsgEmailSecurityNoticeSubject        = "email.security_notice.subject"
	MsgEmailVerificationCode             = "email.verification.code"
	MsgEmailVerificationGreeting         = "email.verification.greeting"
	MsgEmailVerificationSubject          = "email.verification.subject"
	MsgEmailVerificationValidity         = "email.verification.validity"
	MsgSecurityEventEmailChangeRequested = "email.security_event.email_change_requested"
	MsgSecurityEventEmailChanged         = "email.security_event.email_changed"
	MsgSecurityEventEmailConfirmed       = "email.security_event.email_confirmed"
	MsgSecurityEventLoginLinked          = "email.security_event.login_linked"
	MsgSecurityEventLoginUnlinked        = "email.security_event.login_unlinked"
	MsgSecurityEventPasswordUpdated      = "email.security_event.password_updated"
	MsgSecurityEventWeChatLinked         = "email.security_event.wechat_linked"
)

// group messages
const (
	MsgGroupIdMissing     = "group.id_missing"
	MsgGroupNameExists    = "group.name_exists"
	MsgGroupNameTypeEmpty = "group.name_type_empty"
)

// model messages
const (
	MsgModelGetFailed     = "model.get_failed"
	MsgModelGetListFailed = "model.get_list_failed"
	MsgModelIdMissing     = "model.id_missing"
	MsgModelNameEmpty     = "model.name_empty"
	MsgModelNameExists    = "model.name_exists"
	MsgModelResetSuccess  = "model.reset_success"
)

// notify messages
const (
	MsgNotifyQuotaLowBark              = "notify.quota_low_bark"
	MsgNotifyQuotaLowEmail             = "notify.quota_low_email"
	MsgNotifyQuotaLowGotify            = "notify.quota_low_gotify"
	MsgNotifyQuotaLowTitle             = "notify.quota_low_title"
	MsgNotifySubscriptionQuotaLowTitle = "notify.subscription_quota_low_title"
)

// oauth messages
const (
	MsgOAuthAccountUsed     = "oauth.account_used"
	MsgOAuthAlreadyBound    = "oauth.already_bound"
	MsgOAuthBindSuccess     = "oauth.bind_success"
	MsgOAuthConnectFailed   = "oauth.connect_failed"
	MsgOAuthGetUserErr      = "oauth.get_user_error"
	MsgOAuthInvalidCode     = "oauth.invalid_code"
	MsgOAuthNotEnabled      = "oauth.not_enabled"
	MsgOAuthStateInvalid    = "oauth.state_invalid"
	MsgOAuthTokenFailed     = "oauth.token_failed"
	MsgOAuthTrustLevelLow   = "oauth.trust_level_low"
	MsgOAuthUnknownProvider = "oauth.unknown_provider"
	MsgOAuthUserBanned      = "oauth.user_banned"
	MsgOAuthUserDeleted     = "oauth.user_deleted"
	MsgOAuthUserInfoEmpty   = "oauth.user_info_empty"
)

// passkey messages
const (
	MsgPasskeyCreateFailed            = "passkey.create_failed"
	MsgPasskeyInvalidUserId           = "passkey.invalid_user_id"
	MsgPasskeyLoginAbnormal           = "passkey.login_abnormal"
	MsgPasskeyRPIDInvalid             = "passkey.rp_id_invalid"
	MsgPasskeyRPIDRemovalConfirmation = "passkey.rp_id_removal_confirmation"
	MsgPasskeyRPIDUnavailable         = "passkey.rp_id_unavailable"
	MsgPasskeyUpdateFailed            = "passkey.update_failed"
	MsgPasskeyVerifyFailed            = "passkey.verify_failed"
)

// payment messages
const (
	MsgPaymentAmountTooLow       = "payment.amount_too_low"
	MsgPaymentCallbackError      = "payment.callback_error"
	MsgPaymentComplianceRequired = "payment.compliance_required"
	MsgPaymentCreateFailed       = "payment.create_failed"
	MsgPaymentCreemNotConfig     = "payment.creem_not_configured"
	MsgPaymentMethodNotExists    = "payment.method_not_exists"
	MsgPaymentNotConfigured      = "payment.not_configured"
	MsgPaymentPriceIdNotConfig   = "payment.price_id_not_configured"
	MsgPaymentStartFailed        = "payment.start_failed"
	MsgPaymentStripeNotConfig    = "payment.stripe_not_configured"
	MsgPaymentWebhookNotConfig   = "payment.webhook_not_configured"
)

// performance messages
const (
	MsgPerfDiskCacheCleared = "performance.disk_cache_cleared"
	MsgPerfGcExecuted       = "performance.gc_executed"
	MsgPerfStatsReset       = "performance.stats_reset"
)

// quota messages
const (
	MsgQuotaExceedMax                = "quota.exceed_max"
	MsgQuotaInsufficient             = "quota.insufficient"
	MsgQuotaNegative                 = "quota.negative"
	MsgQuotaPreConsumeInsufficient   = "quota.pre_consume_insufficient"
	MsgQuotaSubscriptionInsufficient = "quota.subscription_insufficient"
	MsgQuotaThresholdGtZero          = "quota.threshold_gt_zero"
	MsgQuotaUserInsufficient         = "quota.user_insufficient"
	MsgQuotaWarningInvalid           = "quota.warning_invalid"
)

// rate_limit messages
const (
	MsgRateLimitReached      = "rate_limit.reached"
	MsgRateLimitTotalReached = "rate_limit.total_reached"
)

// redeem messages
const (
	MsgRedeemFailed = "redeem.failed"
)

// redemption messages
const (
	MsgRedemptionCountMax          = "redemption.count_max"
	MsgRedemptionCountPositive     = "redemption.count_positive"
	MsgRedemptionCreateFailed      = "redemption.create_failed"
	MsgRedemptionExpireTimeInvalid = "redemption.expire_time_invalid"
	MsgRedemptionExpired           = "redemption.expired"
	MsgRedemptionFailed            = "redemption.failed"
	MsgRedemptionInvalid           = "redemption.invalid"
	MsgRedemptionNameLength        = "redemption.name_length"
	MsgRedemptionNotProvided       = "redemption.not_provided"
	MsgRedemptionUsed              = "redemption.used"
)

// relay messages
const (
	MsgRelayAccessTokenUnsupported       = "relay.access_token_unsupported"
	MsgRelayGroupSaturated               = "relay.group_saturated"
	MsgRelayGroupUpstreamSaturated       = "relay.group_upstream_saturated"
	MsgRelayModelPriceNotConfigured      = "relay.model_price_not_configured"
	MsgRelayModelPriceNotConfiguredAdmin = "relay.model_price_not_configured_admin"
	MsgRelayRetryGetChannelFailed        = "relay.retry_get_channel_failed"
	MsgRelayRetryNoAvailableChannel      = "relay.retry_no_available_channel"
	MsgRelaySharedTaskPriceNeedsOverride = "relay.shared_task_price_needs_override"
	MsgRelayTaskChannelDisabled          = "relay.task_channel_disabled"
	MsgRelayTaskUsagePriceUnsupported    = "relay.task_usage_price_unsupported"
)

// setting messages
const (
	MsgSettingBarkUrlEmpty     = "setting.bark_url_empty"
	MsgSettingBarkUrlInvalid   = "setting.bark_url_invalid"
	MsgSettingEmailInvalid     = "setting.email_invalid"
	MsgSettingGotifyTokenEmpty = "setting.gotify_token_empty"
	MsgSettingGotifyUrlEmpty   = "setting.gotify_url_empty"
	MsgSettingGotifyUrlInvalid = "setting.gotify_url_invalid"
	MsgSettingInvalidType      = "setting.invalid_type"
	MsgSettingSaved            = "setting.saved"
	MsgSettingUrlMustHttp      = "setting.url_must_http"
	MsgSettingWebhookEmpty     = "setting.webhook_empty"
	MsgSettingWebhookInvalid   = "setting.webhook_invalid"
)

// subscription messages
const (
	MsgSubscriptionGroupNotExists   = "subscription.group_not_exists"
	MsgSubscriptionInvalidId        = "subscription.invalid_id"
	MsgSubscriptionInvalidUserId    = "subscription.invalid_user_id"
	MsgSubscriptionNotEnabled       = "subscription.not_enabled"
	MsgSubscriptionPriceMax         = "subscription.price_max"
	MsgSubscriptionPriceNegative    = "subscription.price_negative"
	MsgSubscriptionPurchaseLimitNeg = "subscription.purchase_limit_negative"
	MsgSubscriptionPurchaseMax      = "subscription.purchase_max"
	MsgSubscriptionQuotaNegative    = "subscription.quota_negative"
	MsgSubscriptionResetCycleGtZero = "subscription.reset_cycle_gt_zero"
	MsgSubscriptionTitleEmpty       = "subscription.title_empty"
)

// task_plugin messages
const (
	MsgTaskPluginUnknownMetaField = "task_plugin.unknown_meta_field"
)

// token messages
const (
	MsgTokenAutoGroupsDuplicate  = "token.auto_groups_duplicate"
	MsgTokenAutoGroupsInvalid    = "token.auto_groups_invalid"
	MsgTokenAutoGroupsTooMany    = "token.auto_groups_too_many"
	MsgTokenDbError              = "token.db_error"
	MsgTokenExhausted            = "token.exhausted"
	MsgTokenExhaustedCannotEable = "token.exhausted_cannot_enable"
	MsgTokenExpired              = "token.expired"
	MsgTokenExpiredCannotEnable  = "token.expired_cannot_enable"
	MsgTokenGenerateFailed       = "token.generate_failed"
	MsgTokenGetInfoFailed        = "token.get_info_failed"
	MsgTokenGroupNameEmpty       = "token.group_name_empty"
	MsgTokenGroupNameExists      = "token.group_name_exists"
	MsgTokenGroupNameInvalid     = "token.group_name_invalid"
	MsgTokenGroupNameTooLong     = "token.group_name_too_long"
	MsgTokenGroupNotFound        = "token.group_not_found"
	MsgTokenGroupNotSelectable   = "token.group_not_selectable"
	MsgTokenInvalid              = "token.invalid"
	MsgTokenNameTooLong          = "token.name_too_long"
	MsgTokenNotProvided          = "token.not_provided"
	MsgTokenQuotaExceedMax       = "token.quota_exceed_max"
	MsgTokenQuotaNegative        = "token.quota_negative"
	MsgTokenStatusUnavailable    = "token.status_unavailable"
)

// topup messages
const (
	MsgTopupFailed         = "topup.failed"
	MsgTopupInvalidQuota   = "topup.invalid_quota"
	MsgTopupNotProvided    = "topup.not_provided"
	MsgTopupOrderNotExists = "topup.order_not_exists"
	MsgTopupOrderStatus    = "topup.order_status"
)

// twofa messages
const (
	MsgTwoFAAlreadyExists = "twofa.already_exists"
	MsgTwoFACodeInvalid   = "twofa.code_invalid"
	MsgTwoFANotEnabled    = "twofa.not_enabled"
	MsgTwoFARecordIdEmpty = "twofa.record_id_empty"
	MsgTwoFAUserIdEmpty   = "twofa.user_id_empty"
)

// user messages
const (
	MsgCreateDefaultTokenErr         = "user.create_default_token_error"
	MsgUserAdminCannotPromote        = "user.admin_cannot_promote"
	MsgUserAffCodeEmpty              = "user.aff_code_empty"
	MsgUserAlreadyAdmin              = "user.already_admin"
	MsgUserAlreadyCommon             = "user.already_common"
	MsgUserCannotCreateHigherLevel   = "user.cannot_create_higher_level"
	MsgUserCannotDeleteRootUser      = "user.cannot_delete_root_user"
	MsgUserCannotDemoteRootUser      = "user.cannot_demote_root_user"
	MsgUserCannotDisableRootUser     = "user.cannot_disable_root_user"
	MsgUserDefaultTokenFailed        = "user.default_token_failed"
	MsgUserDefaultTokenName          = "user.default_token_name"
	MsgUserDisabled                  = "user.disabled"
	MsgUserDiscordIdEmpty            = "user.discord_id_empty"
	MsgUserEmailAlreadyTaken         = "user.email_already_taken"
	MsgUserEmailEmpty                = "user.email_empty"
	MsgUserEmailOrPasswordEmpty      = "user.email_or_password_empty"
	MsgUserEmailVerificationRequired = "user.email_verification_required"
	MsgUserExists                    = "user.exists"
	MsgUserGitHubIdEmpty             = "user.github_id_empty"
	MsgUserInputInvalid              = "user.input_invalid"
	MsgUserInviteQuotaInsufficient   = "user.invite_quota_insufficient"
	MsgUserLinuxDOIdEmpty            = "user.linux_do_id_empty"
	MsgUserNoPermissionHigherLevel   = "user.no_permission_higher_level"
	MsgUserNoPermissionSameLevel     = "user.no_permission_same_level"
	MsgUserNotExists                 = "user.not_exists"
	MsgUserOidcIdEmpty               = "user.oidc_id_empty"
	MsgUserOriginalPasswordError     = "user.original_password_error"
	MsgUserPasswordLoginDisabled     = "user.password_login_disabled"
	MsgUserPasswordRegisterDisabled  = "user.password_register_disabled"
	MsgUserPasswordResetLinkInvalid  = "user.password_reset_link_invalid"
	MsgUserPasswordUnset             = "user.password_unset"
	MsgUserQuotaChangeZero           = "user.quota_change_zero"
	MsgUserRegisterDisabled          = "user.register_disabled"
	MsgUserRegisterFailed            = "user.register_failed"
	MsgUserRequire2FA                = "user.require_2fa"
	MsgUserSessionSaveFailed         = "user.session_save_failed"
	MsgUserTelegramIdEmpty           = "user.telegram_id_empty"
	MsgUserTelegramNotBound          = "user.telegram_not_bound"
	MsgUserTopUpProcessing           = "user.topup_processing"
	MsgUserTransferFailed            = "user.transfer_failed"
	MsgUserTransferQuotaMinimum      = "user.transfer_quota_minimum"
	MsgUserTransferSuccess           = "user.transfer_success"
	MsgUserUsernameOrPasswordEmpty   = "user.username_or_password_empty"
	MsgUserUsernameOrPasswordError   = "user.username_or_password_error"
	MsgUserVerificationCodeError     = "user.verification_code_error"
	MsgUserWeChatIdEmpty             = "user.wechat_id_empty"
)

// vendor messages
const (
	MsgVendorIdMissing  = "vendor.id_missing"
	MsgVendorNameEmpty  = "vendor.name_empty"
	MsgVendorNameExists = "vendor.name_exists"
)
