package game

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"
)

func signHub(secret []byte, body string) string {
	b := base64.RawURLEncoding.EncodeToString([]byte(body))
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(b))
	return b + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestHubAvatarURL(t *testing.T) {
	secret := []byte("geheim")
	now := time.Unix(1_000_000, 0)
	good := signHub(secret, `{"v":1,"room":"abc1","pid":"p_x1","name":"Mia","host":false,"exp":1000600}`)
	if url, ok := HubAvatarURL(good, secret, now); !ok || url != "/party-ws/avatar/ABC1/p_x1.svg" {
		t.Fatalf("gültiges Ticket: %q %v", url, ok)
	}
	cases := map[string]string{
		"falscher Schlüssel": signHub([]byte("anders"), `{"room":"ABC1","pid":"p","exp":1000600}`),
		"abgelaufen":         signHub(secret, `{"room":"ABC1","pid":"p","exp":999999}`),
		"Pfad im Raum":       signHub(secret, `{"room":"../x","pid":"p","exp":1000600}`),
		"Pfad in der ID":     signHub(secret, `{"room":"ABC1","pid":"a/b","exp":1000600}`),
		"Müll":               "abc",
	}
	for name, ticket := range cases {
		if _, ok := HubAvatarURL(ticket, secret, now); ok {
			t.Errorf("%s: sollte abgelehnt werden", name)
		}
	}
	if _, ok := HubAvatarURL(good, nil, now); ok {
		t.Error("ohne Schlüssel keine Avatare")
	}
}
