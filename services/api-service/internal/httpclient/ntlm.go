package httpclient

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf16"
)

// errNTLMChallenge 表示 401 里没有可用的 NTLM type 2。
var errNTLMChallenge = errors.New("http: ntlm challenge missing")

const (
	ntlmNegotiateUnicode    uint32 = 0x00000001
	ntlmRequestTarget       uint32 = 0x00000004
	ntlmNegotiateNTLM       uint32 = 0x00000200
	ntlmNegotiateAlwaysSign uint32 = 0x00008000
	ntlmNegotiateExtended   uint32 = 0x00080000
	ntlmNegotiateTargetInfo uint32 = 0x00800000
	ntlmNegotiate128        uint32 = 0x20000000
	ntlmNegotiate56         uint32 = 0x80000000
)

// NTOWFv2 计算 NTLMv2 口令哈希。
func NTOWFv2(user, password, domain string) []byte {
	nt := md4Sum(utf16LE(password))
	mac := hmac.New(md5.New, nt[:])
	_, _ = mac.Write(utf16LE(strings.ToUpper(user) + domain))
	return mac.Sum(nil)
}

func doNTLM(ctx context.Context, client *http.Client, req *http.Request, spec ExchangeRequest, payload []byte) (*http.Response, error) {
	type1 := ntlmType1(spec.NtlmDomain)
	first, err := cloneRequest(ctx, req, payload)
	if err != nil {
		return nil, err
	}
	first.Header.Set("Authorization", "NTLM "+base64.StdEncoding.EncodeToString(type1))
	first.Header.Set("Connection", "Keep-Alive")
	resp, err := client.Do(first)
	if err != nil {
		return nil, err
	}
	token, tokenErr := challengeBytes(resp.Header.Get("WWW-Authenticate"))
	if resp.StatusCode != http.StatusUnauthorized || tokenErr != nil {
		return resp, nil
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	type3, err := ntlmType3(spec.NtlmUser, spec.NtlmPassword, spec.NtlmDomain, token)
	if err != nil {
		return nil, err
	}
	second, err := cloneRequest(ctx, req, payload)
	if err != nil {
		return nil, err
	}
	second.Header.Set("Authorization", "NTLM "+base64.StdEncoding.EncodeToString(type3))
	return client.Do(second)
}

func cloneRequest(ctx context.Context, req *http.Request, payload []byte) (*http.Request, error) {
	var body io.Reader
	if len(payload) > 0 && req.Method != http.MethodGet && req.Method != http.MethodHead {
		body = bytesReader(payload)
	}
	next, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), body)
	if err != nil {
		return nil, err
	}
	next.Header = req.Header.Clone()
	next.Host = req.Host
	return next, nil
}

func bytesReader(payload []byte) io.Reader {
	return strings.NewReader(string(payload))
}

func challengeBytes(header string) ([]byte, error) {
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if len(part) < 5 || !strings.EqualFold(part[:4], "NTLM") {
			continue
		}
		raw := strings.TrimSpace(part[4:])
		if raw == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, err
		}
		return decoded, nil
	}
	return nil, errNTLMChallenge
}

func ntlmType1(domain string) []byte {
	domainBytes := utf16LE(domain)
	flags := ntlmNegotiateUnicode | ntlmRequestTarget | ntlmNegotiateNTLM | ntlmNegotiateAlwaysSign |
		ntlmNegotiateExtended | ntlmNegotiateTargetInfo | ntlmNegotiate128 | ntlmNegotiate56
	buf := make([]byte, 32+len(domainBytes))
	copy(buf, []byte("NTLMSSP\x00"))
	binary.LittleEndian.PutUint32(buf[8:], 1)
	binary.LittleEndian.PutUint32(buf[12:], flags)
	binary.LittleEndian.PutUint16(buf[16:], uint16(len(domainBytes)))
	binary.LittleEndian.PutUint16(buf[18:], uint16(len(domainBytes)))
	binary.LittleEndian.PutUint32(buf[20:], 32)
	copy(buf[32:], domainBytes)
	return buf
}

func ntlmType3(user, password, domain string, type2 []byte) ([]byte, error) {
	if len(type2) < 48 || string(type2[:8]) != "NTLMSSP\x00" || binary.LittleEndian.Uint32(type2[8:]) != 2 {
		return nil, errNTLMChallenge
	}
	challenge := type2[24:32]
	targetInfo := readSecurityBuffer(type2, 40)
	clientChallenge := make([]byte, 8)
	if _, err := rand.Read(clientChallenge); err != nil {
		return nil, err
	}
	ntowf := NTOWFv2(user, password, domain)
	blob := ntlmBlob(clientChallenge, targetInfo)
	ntProof := hmacMD5(ntowf, append(append([]byte{}, challenge...), blob...))
	ntResp := append(ntProof, blob...)
	lm := append(hmacMD5(ntowf, append(append([]byte{}, challenge...), clientChallenge...)), clientChallenge...)
	userBytes := utf16LE(user)
	domainBytes := utf16LE(domain)
	base := 64
	offset := base
	domainOff := offset
	offset += len(domainBytes)
	userOff := offset
	offset += len(userBytes)
	lmOff := offset
	offset += len(lm)
	ntOff := offset
	buf := make([]byte, offset+len(ntResp))
	copy(buf, []byte("NTLMSSP\x00"))
	binary.LittleEndian.PutUint32(buf[8:], 3)
	putSec(buf, 12, len(lm), lmOff)
	putSec(buf, 20, len(ntResp), ntOff)
	putSec(buf, 28, len(domainBytes), domainOff)
	putSec(buf, 36, len(userBytes), userOff)
	binary.LittleEndian.PutUint32(buf[60:], ntlmNegotiateUnicode|ntlmNegotiateNTLM|ntlmNegotiateExtended|ntlmNegotiate128)
	copy(buf[domainOff:], domainBytes)
	copy(buf[userOff:], userBytes)
	copy(buf[lmOff:], lm)
	copy(buf[ntOff:], ntResp)
	return buf, nil
}

func ntlmBlob(clientChallenge, targetInfo []byte) []byte {
	blob := make([]byte, 28+len(targetInfo)+4)
	blob[0] = 0x01
	blob[1] = 0x01
	binary.LittleEndian.PutUint64(blob[8:], fileTimeNow())
	copy(blob[16:], clientChallenge)
	copy(blob[28:], targetInfo)
	return blob
}

func fileTimeNow() uint64 {
	const unixToFile = 116444736000000000
	return uint64(time.Now().UnixNano()/100) + unixToFile
}

func hmacMD5(key, data []byte) []byte {
	mac := hmac.New(md5.New, key)
	_, _ = mac.Write(data)
	return mac.Sum(nil)
}

func putSec(buf []byte, at, length, offset int) {
	binary.LittleEndian.PutUint16(buf[at:], uint16(length))
	binary.LittleEndian.PutUint16(buf[at+2:], uint16(length))
	binary.LittleEndian.PutUint32(buf[at+4:], uint32(offset))
}

func readSecurityBuffer(msg []byte, at int) []byte {
	if len(msg) < at+8 {
		return nil
	}
	length := int(binary.LittleEndian.Uint16(msg[at:]))
	offset := int(binary.LittleEndian.Uint32(msg[at+4:]))
	if length == 0 || offset < 0 || offset+length > len(msg) {
		return nil
	}
	out := make([]byte, length)
	copy(out, msg[offset:offset+length])
	return out
}

func utf16LE(value string) []byte {
	units := utf16.Encode([]rune(value))
	out := make([]byte, len(units)*2)
	for i, unit := range units {
		binary.LittleEndian.PutUint16(out[i*2:], unit)
	}
	return out
}

func md4Sum(data []byte) [16]byte {
	var digest [16]byte
	bitLen := uint64(len(data)) * 8
	pad := make([]byte, len(data)+9+63)
	copy(pad, data)
	pad[len(data)] = 0x80
	size := (len(data) + 9 + 63) &^ 63
	pad = pad[:size]
	binary.LittleEndian.PutUint64(pad[size-8:], bitLen)
	a, b, c, d := uint32(0x67452301), uint32(0xefcdab89), uint32(0x98badcfe), uint32(0x10325476)
	for off := 0; off < len(pad); off += 64 {
		var x [16]uint32
		for i := 0; i < 16; i++ {
			x[i] = binary.LittleEndian.Uint32(pad[off+i*4:])
		}
		aa, bb, cc, dd := a, b, c, d
		a, b, c, d = md4Round(a, b, c, d, x)
		a += aa
		b += bb
		c += cc
		d += dd
	}
	binary.LittleEndian.PutUint32(digest[0:], a)
	binary.LittleEndian.PutUint32(digest[4:], b)
	binary.LittleEndian.PutUint32(digest[8:], c)
	binary.LittleEndian.PutUint32(digest[12:], d)
	return digest
}

func md4Round(a, b, c, d uint32, x [16]uint32) (uint32, uint32, uint32, uint32) {
	f := func(x, y, z uint32) uint32 { return (x & y) | (^x & z) }
	g := func(x, y, z uint32) uint32 { return (x & y) | (x & z) | (y & z) }
	h := func(x, y, z uint32) uint32 { return x ^ y ^ z }
	shift := func(v uint32, s uint) uint32 { return (v << s) | (v >> (32 - s)) }
	step := func(fn func(uint32, uint32, uint32) uint32, a, b, c, d, k uint32, s uint, t uint32) uint32 {
		return shift(a+fn(b, c, d)+k+t, s)
	}
	a = step(f, a, b, c, d, x[0], 3, 0)
	d = step(f, d, a, b, c, x[1], 7, 0)
	c = step(f, c, d, a, b, x[2], 11, 0)
	b = step(f, b, c, d, a, x[3], 19, 0)
	a = step(f, a, b, c, d, x[4], 3, 0)
	d = step(f, d, a, b, c, x[5], 7, 0)
	c = step(f, c, d, a, b, x[6], 11, 0)
	b = step(f, b, c, d, a, x[7], 19, 0)
	a = step(f, a, b, c, d, x[8], 3, 0)
	d = step(f, d, a, b, c, x[9], 7, 0)
	c = step(f, c, d, a, b, x[10], 11, 0)
	b = step(f, b, c, d, a, x[11], 19, 0)
	a = step(f, a, b, c, d, x[12], 3, 0)
	d = step(f, d, a, b, c, x[13], 7, 0)
	c = step(f, c, d, a, b, x[14], 11, 0)
	b = step(f, b, c, d, a, x[15], 19, 0)
	const t2 = 0x5a827999
	a = step(g, a, b, c, d, x[0], 3, t2)
	d = step(g, d, a, b, c, x[4], 5, t2)
	c = step(g, c, d, a, b, x[8], 9, t2)
	b = step(g, b, c, d, a, x[12], 13, t2)
	a = step(g, a, b, c, d, x[1], 3, t2)
	d = step(g, d, a, b, c, x[5], 5, t2)
	c = step(g, c, d, a, b, x[9], 9, t2)
	b = step(g, b, c, d, a, x[13], 13, t2)
	a = step(g, a, b, c, d, x[2], 3, t2)
	d = step(g, d, a, b, c, x[6], 5, t2)
	c = step(g, c, d, a, b, x[10], 9, t2)
	b = step(g, b, c, d, a, x[14], 13, t2)
	a = step(g, a, b, c, d, x[3], 3, t2)
	d = step(g, d, a, b, c, x[7], 5, t2)
	c = step(g, c, d, a, b, x[11], 9, t2)
	b = step(g, b, c, d, a, x[15], 13, t2)
	const t3 = 0x6ed9eba1
	a = step(h, a, b, c, d, x[0], 3, t3)
	d = step(h, d, a, b, c, x[8], 9, t3)
	c = step(h, c, d, a, b, x[4], 11, t3)
	b = step(h, b, c, d, a, x[12], 15, t3)
	a = step(h, a, b, c, d, x[2], 3, t3)
	d = step(h, d, a, b, c, x[10], 9, t3)
	c = step(h, c, d, a, b, x[6], 11, t3)
	b = step(h, b, c, d, a, x[14], 15, t3)
	a = step(h, a, b, c, d, x[1], 3, t3)
	d = step(h, d, a, b, c, x[9], 9, t3)
	c = step(h, c, d, a, b, x[5], 11, t3)
	b = step(h, b, c, d, a, x[13], 15, t3)
	a = step(h, a, b, c, d, x[3], 3, t3)
	d = step(h, d, a, b, c, x[11], 9, t3)
	c = step(h, c, d, a, b, x[7], 11, t3)
	b = step(h, b, c, d, a, x[15], 15, t3)
	return a, b, c, d
}
