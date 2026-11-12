package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// UserVerificationState is an authoritative, credential-free projection for
// choosing an authentication method. Loading it never fetches credential secrets.
type UserVerificationState struct {
	UserID      int
	Status      int
	Role        int
	AuthVersion int64
	HasPassword bool
	HasTwoFA    bool
	TwoFALocked bool
	HasPasskey  bool
}

func GetUserVerificationState(userID int) (*UserVerificationState, error) {
	return getUserVerificationState(DB, userID, false)
}

func getUserVerificationState(tx *gorm.DB, userID int, forUpdate bool) (*UserVerificationState, error) {
	if userID <= 0 {
		return nil, ErrUserSessionInvalid
	}
	var state UserVerificationState
	query := tx.Model(&User{}).Select(
		"id AS user_id, status, role, auth_version, CASE WHEN password <> '' THEN 1 ELSE 0 END AS has_password, "+
			"EXISTS (?) AS has_two_fa, EXISTS (?) AS two_fa_locked, EXISTS (?) AS has_passkey",
		tx.Model(&TwoFA{}).Select("1").Where("user_id = ? AND is_enabled = ?", userID, true),
		tx.Model(&TwoFA{}).Select("1").Where("user_id = ? AND is_enabled = ? AND locked_until > ?", userID, true, time.Now()),
		tx.Model(&PasskeyCredential{}).Select("1").Where("user_id = ?", userID),
	).Where("id = ?", userID)
	if forUpdate {
		query = lockForUpdate(query)
	}
	if err := query.Take(&state).Error; err != nil {
		return nil, err
	}
	return &state, nil
}

// CreateUserSessionFromLoginFlow commits the one-time login authorization and
// the resulting session together. The user lock serializes credential changes
// and session issuance. Capacity is made available before the transaction
// because eviction publishes Redis deny fences, which must not be written
// inside a database transaction; the in-transaction count stays as the
// authoritative fail-closed guard.
func CreateUserSessionFromLoginFlow(token string, session *UserSession, validate func(*AuthFlow, *UserVerificationState) error) error {
	if session == nil || validate == nil {
		return ErrUserSessionInvalid
	}
	now := time.Now().Unix()
	if err := EnsureUserSessionCapacity(session.UserID, now); err != nil {
		return err
	}
	cacheDeadline := userSessionCacheDeadline()
	_, err := ConsumeAuthFlowWithAction(token, AuthFlowMatch{
		Purpose: AuthFlowPurposeLoginVerification, UserId: session.UserID,
	}, func(tx *gorm.DB, flow *AuthFlow) error {
		state, err := getUserVerificationState(tx, session.UserID, true)
		if err != nil {
			return err
		}
		if state.Status != common.UserStatusEnabled || state.AuthVersion != session.UserAuthVersion {
			return ErrUserSessionInactive
		}
		if err := validate(flow, state); err != nil {
			return err
		}
		activeQuery := tx.Model(&UserSession{}).Where("user_id = ? AND status = ? AND expires_at > ?", session.UserID, UserSessionStatusActive, now)
		if cutoff := idleCutoff(now); cutoff > 0 {
			activeQuery = activeQuery.Where("last_active_at > ?", cutoff)
		}
		var activeCount, issuanceCount int64
		if err := activeQuery.Count(&activeCount).Error; err != nil {
			return err
		}
		if activeCount >= int64(common.UserSessionActiveLimit) {
			return ErrUserSessionLimit
		}
		if err := tx.Model(&UserSession{}).Where("user_id = ? AND created_at > ?", session.UserID, now-common.UserSessionIssuanceWindowSeconds).Count(&issuanceCount).Error; err != nil {
			return err
		}
		if issuanceCount >= int64(common.UserSessionIssuanceLimit) {
			return ErrUserSessionIssuanceLimit
		}
		return createUserSessionWithTx(tx, session)
	})
	if err != nil {
		return err
	}
	return publishCreatedUserSession(session, cacheDeadline)
}
