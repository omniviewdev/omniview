package resource

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const profileCredentialPrefix = "connection-credentials-"
const maxProfileCredentialBytes = 16 << 10
const maxProfileCredentialStoreBytes = 12*maxProfileCredentialBytes + 4096

// Each immutable private file belongs to exactly one profile incarnation. The
// public profile commit is the sole pointer switch, so a failed save or crash
// cannot pair old public configuration with newly entered credentials.
type storedProfileCredentials struct {
	ID         string            `json:"id"`
	UID        string            `json:"uid"`
	DataDigest string            `json:"dataDigest"`
	Values     map[string]string `json:"values"`
}

func profileCredentialDataDigest(config profileConfiguration) (string, error) {
	// Config has already crossed the lossless JSON boundary. Marshal sorts map
	// keys without rounding json.Number values or including display metadata.
	data, err := json.Marshal(config.Data)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func validProfileCredentialValues(values map[string]string) bool {
	if len(values) > 2 {
		return false
	}
	for key, value := range values {
		if (key != "username" && key != "token") || len(value) > maxProfileCredentialBytes || !utf8.ValidString(value) {
			return false
		}
	}
	return true
}

func hydrateProfileCredentials(root *appstate.ScopedRoot, state *desiredConnectionState) error {
	for i := range state.Profiles {
		profile := &state.Profiles[i]
		if profile.CredentialsRef == "" {
			continue
		}
		if _, err := uuid.Parse(profile.CredentialsRef); err != nil {
			return errors.New("connection profiles: invalid private credential reference")
		}
		file, err := openProfileCredentialFile(root, profileCredentialPrefix+profile.CredentialsRef)
		if err != nil {
			return errors.New("connection profiles: private credentials unavailable")
		}
		if err := validateProfileCredentialFile(file); err != nil {
			file.Close()
			return errors.New("connection profiles: private credential permissions are unsafe")
		}
		data, readErr := io.ReadAll(io.LimitReader(file, maxProfileCredentialStoreBytes+1))
		file.Close()
		if readErr != nil || len(data) > maxProfileCredentialStoreBytes || resourcev2.ValidateJSON(data) != nil {
			return errors.New("connection profiles: invalid private credential store")
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		var stored storedProfileCredentials
		digest, err := profileCredentialDataDigest(profile.Configuration)
		if err != nil || decoder.Decode(&stored) != nil || stored.ID != profile.Configuration.ID || stored.UID != profile.Configuration.UID || stored.DataDigest != digest || !validProfileCredentialValues(stored.Values) {
			return errors.New("connection profiles: invalid private credential ownership")
		}
		profile.credentials = make(map[string]any, len(stored.Values))
		for key, value := range stored.Values {
			profile.credentials[key] = value
		}
	}
	return nil
}

func prepareProfileCredentials(root *appstate.ScopedRoot, previous desiredConnectionState, origin string, connection types.Connection, input *ConnectionProfileCredentials) (desiredConnectionProfile, error) {
	var config profileConfiguration
	data, err := json.Marshal(profileConfig(connection))
	if err != nil {
		return desiredConnectionProfile{}, resourcev2.NewError("INVALID_REQUEST", "Connection configuration is not valid JSON.")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&config); err != nil {
		return desiredConnectionProfile{}, resourcev2.NewError("INVALID_REQUEST", "Connection configuration is not valid JSON.")
	}
	profile := desiredConnectionProfile{Source: origin, Configuration: config}
	if err := resourcev2.ValidateConnectionOverlay(resourcev2.ConnectionOverlay{Upserts: []types.Connection{profile.Configuration.connection()}}); err != nil {
		return desiredConnectionProfile{}, err
	}
	for _, prior := range previous.Profiles {
		if prior.Configuration.ID == connection.ID && prior.Configuration.UID == connection.UID && reflect.DeepEqual(prior.Configuration.Data, config.Data) {
			profile.CredentialsRef = prior.CredentialsRef
			profile.credentials = prior.credentials
			break
		}
	}
	if input == nil || (input.Username == nil && input.Token == nil) {
		return profile, nil
	}
	values := make(map[string]string, 2)
	for key, value := range profile.credentials {
		if text, ok := value.(string); ok {
			values[key] = text
		}
	}
	for key, value := range map[string]*string{"username": input.Username, "token": input.Token} {
		if value != nil {
			if len(*value) > maxProfileCredentialBytes || !utf8.ValidString(*value) {
				return desiredConnectionProfile{}, resourcev2.NewError("INVALID_REQUEST", "Connection credential exceeds the UTF-8 string limit.")
			}
			delete(values, key)
			if *value != "" {
				values[key] = *value
			}
		}
	}
	// A non-nil empty private map explicitly clears native credential inheritance.
	profile.credentials = make(map[string]any, len(values))
	for key, value := range values {
		profile.credentials[key] = value
	}
	if err := utils.InitializePluginStore(root); err != nil {
		return desiredConnectionProfile{}, err
	}
	// Check Windows inheritance before creating even an empty file, so an
	// untrusted principal cannot retain a pre-opened handle across restriction.
	if err := validateProfileCredentialDirectory(root); err != nil {
		return desiredConnectionProfile{}, errors.New("connection profiles: private credential directory permissions are unsafe")
	}
	profile.CredentialsRef = uuid.NewString()
	name := profileCredentialPrefix + profile.CredentialsRef
	digest, err := profileCredentialDataDigest(config)
	if err != nil {
		return desiredConnectionProfile{}, errors.New("connection profiles: cannot bind private credentials")
	}
	data, err = json.Marshal(storedProfileCredentials{ID: connection.ID, UID: connection.UID, DataDigest: digest, Values: values})
	if err != nil || len(data) > maxProfileCredentialStoreBytes {
		return desiredConnectionProfile{}, errors.New("connection profiles: cannot encode private credentials")
	}
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return desiredConnectionProfile{}, errors.New("connection profiles: cannot create private credentials")
	}
	if err := restrictProfileCredentialFile(file); err != nil {
		file.Close()
		root.Remove(name)
		return desiredConnectionProfile{}, errors.New("connection profiles: cannot secure private credentials")
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	// Persist the new name before the public profile is allowed to reference it.
	if err == nil {
		err = syncConnectionProfileDirectory(root)
	}
	if err != nil {
		root.Remove(name)
		return desiredConnectionProfile{}, errors.New("connection profiles: cannot persist private credentials")
	}
	return profile, nil
}

// Cleanup follows a committed pointer switch or a failed pre-commit transaction.
// A process crash can leave an unreferenced private file, never a wrong pairing.
func removeUnreferencedProfileCredentials(root *appstate.ScopedRoot, retained, discarded desiredConnectionState) error {
	live := make(map[string]bool, len(retained.Profiles))
	removed := false
	for _, profile := range retained.Profiles {
		live[profile.CredentialsRef] = true
	}
	for _, profile := range discarded.Profiles {
		if profile.CredentialsRef != "" && !live[profile.CredentialsRef] {
			if err := root.Remove(profileCredentialPrefix + profile.CredentialsRef); err != nil && !os.IsNotExist(err) {
				return resourcev2.NewError("RESET_REQUIRED", "Connection profile changed but obsolete private credentials could not be removed. Reload before using this connection.")
			}
			removed = true
		}
	}
	if removed {
		err := syncConnectionProfileDirectory(root)
		if err != nil {
			return resourcev2.NewError("RESET_REQUIRED", "Private credential removal durability is unknown. Reload before using this connection.")
		}
	}
	return nil
}

// Recovery removes files left before a failed or interrupted pointer switch.
// Callers serialize reads and mutations with profilesMu.
func collectProfileCredentialOrphans(root *appstate.ScopedRoot, retained desiredConnectionState) error {
	// Make the currently observed public pointer durable before unlinking any
	// file that an older, pre-crash directory state might still reference.
	err := syncConnectionProfileDirectory(root)
	if err != nil {
		return resourcev2.NewError("RESET_REQUIRED", "Connection profile recovery durability is unknown. Reload before using this connection.")
	}
	entries, err := root.ReadDir(".")
	if err != nil {
		return errors.New("connection profiles: cannot inspect private credential storage")
	}
	discarded := emptyDesiredConnections()
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), profileCredentialPrefix) {
			continue
		}
		ref := strings.TrimPrefix(entry.Name(), profileCredentialPrefix)
		if parsed, err := uuid.Parse(ref); err == nil && parsed.String() == ref {
			discarded.Profiles = append(discarded.Profiles, desiredConnectionProfile{CredentialsRef: ref})
		}
	}
	return removeUnreferencedProfileCredentials(root, retained, discarded)
}
