package game

// Treffen-Hub: Avatare. Der Hub hängt jedem Spieler ein signiertes Ticket an die Spiel-URL
// (HMAC-SHA256 mit TREFFEN_TICKET_SECRET, Format base64url(JSON) + "." + base64url(Signatur)).
// Der Client schickt es nach dem Verbinden als "hub-avatar"; aus Raum und Hub-Spieler-ID im
// Ticket wird die Bild-URL des party-servers (/party-ws/avatar/<RAUM>/<ID>.svg).
// Ohne gültiges Ticket bleibt der Spieler ohne Avatar – niemand kann sich ein fremdes Bild geben.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	json "encoding/json"
	"os"
	"regexp"
	"strings"
	"time"
)

var (
	hubTicketSecret = []byte(strings.TrimSpace(os.Getenv("TREFFEN_TICKET_SECRET")))
	hubRoomRe       = regexp.MustCompile(`^[A-Z0-9_-]{1,32}$`)
	hubPidRe        = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

type hubTicket struct {
	Room string  `json:"room"`
	Pid  string  `json:"pid"`
	Exp  float64 `json:"exp"`
}

func b64urlDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
}

// HubAvatarURL prüft ein Hub-Ticket und liefert die Avatar-URL (oder "", false).
func HubAvatarURL(ticket string, secret []byte, now time.Time) (string, bool) {
	if len(secret) == 0 || len(ticket) > 2048 || strings.Count(ticket, ".") != 1 {
		return "", false
	}
	body, sig, _ := strings.Cut(ticket, ".")
	got, err := b64urlDecode(sig)
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	if !hmac.Equal(got, mac.Sum(nil)) {
		return "", false
	}
	raw, err := b64urlDecode(body)
	if err != nil {
		return "", false
	}
	var t hubTicket
	if err := json.Unmarshal(raw, &t); err != nil {
		return "", false
	}
	room := strings.ToUpper(t.Room)
	if t.Exp < float64(now.Unix()) || !hubRoomRe.MatchString(room) || !hubPidRe.MatchString(t.Pid) {
		return "", false
	}
	return "/party-ws/avatar/" + room + "/" + t.Pid + ".svg", true
}
