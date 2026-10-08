package httpclient

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Cookie 是工作台往返保存的一条 Cookie（RFC 6265 的子集）。
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Secure   bool   `json:"secure"`
	HTTPOnly bool   `json:"httpOnly"`
	HostOnly bool   `json:"hostOnly"`
	Expires  string `json:"expires,omitempty"`
}

type storedCookie struct {
	name     string
	value    string
	domain   string
	path     string
	expires  time.Time
	hostOnly bool
	secure   bool
	httpOnly bool
}

// Jar 按域名、路径和过期时间收发 Cookie。
type Jar struct {
	mu      sync.Mutex
	cookies []storedCookie
}

// NewJar 创建空 Cookie 罐。
func NewJar() *Jar {
	return &Jar{}
}

// Seed 写入调用方带来的 Cookie，已过期的丢掉。
func (j *Jar) Seed(items []Cookie) {
	now := time.Now()
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		expires := parseExpiry(item.Expires)
		if !expires.IsZero() && !expires.After(now) {
			continue
		}
		j.upsertLocked(storedCookie{
			name:     name,
			value:    item.Value,
			domain:   strings.TrimPrefix(strings.ToLower(strings.TrimSpace(item.Domain)), "."),
			path:     item.Path,
			expires:  expires,
			hostOnly: item.HostOnly,
			secure:   item.Secure,
			httpOnly: item.HTTPOnly,
		})
	}
}

// Snapshot 返回尚未过期的 Cookie。
func (j *Jar) Snapshot() []Cookie {
	now := time.Now()
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make([]Cookie, 0, len(j.cookies))
	for _, item := range j.cookies {
		if !item.expires.IsZero() && !item.expires.After(now) {
			continue
		}
		wire := Cookie{
			Name:     item.name,
			Value:    item.value,
			Domain:   item.domain,
			Path:     item.path,
			Secure:   item.secure,
			HTTPOnly: item.httpOnly,
			HostOnly: item.hostOnly,
		}
		if !item.expires.IsZero() {
			wire.Expires = item.expires.UTC().Format(time.RFC3339)
		}
		out = append(out, wire)
	}
	return out
}

// SetCookies 写入服务端 Set-Cookie。http.Client 在每次响应后调用。
func (j *Jar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	if u == nil {
		return
	}
	now := time.Now()
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, cookie := range cookies {
		if cookie == nil || strings.TrimSpace(cookie.Name) == "" {
			continue
		}
		if cookie.MaxAge < 0 {
			j.removeLocked(cookie.Name, cookieDomain(host, cookie.Domain), cookiePath(u.Path, cookie.Path))
			continue
		}
		expires := cookie.Expires
		if cookie.MaxAge > 0 {
			expires = now.Add(time.Duration(cookie.MaxAge) * time.Second)
		}
		if !expires.IsZero() && !expires.After(now) {
			j.removeLocked(cookie.Name, cookieDomain(host, cookie.Domain), cookiePath(u.Path, cookie.Path))
			continue
		}
		domain := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(cookie.Domain)), ".")
		hostOnly := domain == ""
		if hostOnly {
			domain = host
		} else if !domainMatch(host, domain, false) {
			continue
		}
		path := cookiePath(u.Path, cookie.Path)
		j.upsertLocked(storedCookie{
			name:     cookie.Name,
			value:    cookie.Value,
			domain:   domain,
			path:     path,
			expires:  expires,
			hostOnly: hostOnly,
			secure:   cookie.Secure,
			httpOnly: cookie.HttpOnly,
		})
	}
}

// Cookies 返回这次请求要带上的 Cookie。
func (j *Jar) Cookies(u *url.URL) []*http.Cookie {
	if u == nil {
		return nil
	}
	now := time.Now()
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	https := u.Scheme == "https"
	path := u.Path
	if path == "" {
		path = "/"
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []*http.Cookie
	for _, item := range j.cookies {
		if !item.expires.IsZero() && !item.expires.After(now) {
			continue
		}
		if item.secure && !https {
			continue
		}
		if !domainMatch(host, item.domain, item.hostOnly) || !pathMatch(path, item.path) {
			continue
		}
		out = append(out, &http.Cookie{Name: item.name, Value: item.value})
	}
	return out
}

func (j *Jar) upsertLocked(next storedCookie) {
	if next.path == "" {
		next.path = "/"
	}
	for i, item := range j.cookies {
		if item.name == next.name && item.domain == next.domain && item.path == next.path {
			j.cookies[i] = next
			return
		}
	}
	j.cookies = append(j.cookies, next)
}

func (j *Jar) removeLocked(name, domain, path string) {
	if path == "" {
		path = "/"
	}
	kept := j.cookies[:0]
	for _, item := range j.cookies {
		if item.name == name && item.domain == domain && item.path == path {
			continue
		}
		kept = append(kept, item)
	}
	j.cookies = kept
}

func cookieDomain(host, domain string) string {
	domain = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if domain == "" {
		return host
	}
	return domain
}

func cookiePath(reqPath, path string) string {
	if path == "" {
		return defaultCookiePath(reqPath)
	}
	return path
}

func domainMatch(host, domain string, hostOnly bool) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	domain = strings.TrimPrefix(strings.ToLower(domain), ".")
	if host == "" || domain == "" {
		return false
	}
	if hostOnly || host == domain {
		return host == domain
	}
	return strings.HasSuffix(host, "."+domain)
}

func pathMatch(reqPath, cookiePath string) bool {
	if cookiePath == "" {
		cookiePath = "/"
	}
	if reqPath == "" {
		reqPath = "/"
	}
	if reqPath == cookiePath {
		return true
	}
	if strings.HasPrefix(reqPath, cookiePath) {
		if strings.HasSuffix(cookiePath, "/") {
			return true
		}
		return strings.HasPrefix(reqPath[len(cookiePath):], "/")
	}
	return false
}

func defaultCookiePath(path string) string {
	if path == "" || !strings.HasPrefix(path, "/") {
		return "/"
	}
	slash := strings.LastIndex(path, "/")
	if slash <= 0 {
		return "/"
	}
	return path[:slash]
}

func parseExpiry(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}
