package session

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
)

// hasCustomSSLFiles 判断是否配置了证书文件路径。
func (o ConnectOptions) hasCustomSSLFiles() bool {
	return strings.TrimSpace(o.SSLCA) != "" ||
		strings.TrimSpace(o.SSLCert) != "" ||
		strings.TrimSpace(o.SSLKey) != ""
}

// buildTLS 返回驱动 TLSConfig 名与可选自定义 *tls.Config（后者优先）。
func (o ConnectOptions) buildTLS(addr string, tunnelActive bool) (name string, custom *tls.Config, err error) {
	mode := o.sslModeOrDefault()
	if tunnelActive {
		switch mode {
		case "preferred", "prefer", "allow", "disable":
			return "false", nil, nil
		}
	}

	if !o.hasCustomSSLFiles() {
		return o.effectiveTLSConfig(tunnelActive), nil, nil
	}

	custom, err = o.loadCustomTLS(addr, mode)
	if err != nil {
		return "", nil, err
	}
	return "", custom, nil
}

func (o ConnectOptions) loadCustomTLS(addr, mode string) (*tls.Config, error) {
	rootPool, err := loadCertPool(o.SSLCA)
	if err != nil {
		return nil, fmt.Errorf("mysql: ssl_ca: %w", err)
	}

	var certs []tls.Certificate
	certPath := strings.TrimSpace(o.SSLCert)
	keyPath := strings.TrimSpace(o.SSLKey)
	if certPath != "" || keyPath != "" {
		if certPath == "" || keyPath == "" {
			return nil, fmt.Errorf("mysql: ssl_cert and ssl_key must both be set")
		}
		pair, lerr := tls.LoadX509KeyPair(certPath, keyPath)
		if lerr != nil {
			return nil, fmt.Errorf("mysql: ssl client cert: %w", lerr)
		}
		certs = append(certs, pair)
	}

	host := addr
	if h, _, serr := net.SplitHostPort(addr); serr == nil {
		host = h
	}

	switch mode {
	case "disable":
		return nil, fmt.Errorf("mysql: ssl certificates require a non-disable tls mode")
	case "require", "preferred":
		return &tls.Config{
			RootCAs:            rootPool,
			Certificates:       certs,
			InsecureSkipVerify: true, //nolint:gosec // require/preferred：加密优先，主机名可不校验
			MinVersion:         tls.VersionTLS12,
		}, nil
	case "verify-ca":
		if rootPool == nil {
			return nil, fmt.Errorf("mysql: verify-ca requires ssl_ca")
		}
		pool := rootPool
		return &tls.Config{
			RootCAs:            pool,
			Certificates:       certs,
			InsecureSkipVerify: true, //nolint:gosec // 主机名跳过；链校验见 VerifyPeerCertificate
			MinVersion:         tls.VersionTLS12,
			VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
				return verifyCertChain(rawCerts, pool)
			},
		}, nil
	case "verify-identity":
		if rootPool == nil {
			return nil, fmt.Errorf("mysql: verify-identity requires ssl_ca")
		}
		return &tls.Config{
			RootCAs:            rootPool,
			Certificates:       certs,
			ServerName:         host,
			InsecureSkipVerify: false,
			MinVersion:         tls.VersionTLS12,
		}, nil
	default:
		return &tls.Config{
			RootCAs:            rootPool,
			Certificates:       certs,
			InsecureSkipVerify: true, //nolint:gosec
			MinVersion:         tls.VersionTLS12,
		}, nil
	}
}

func loadCertPool(caPath string) (*x509.CertPool, error) {
	path := strings.TrimSpace(caPath)
	if path == "" {
		return nil, nil
	}
	pemBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pemBytes) {
		return nil, fmt.Errorf("no certificates found in PEM")
	}
	return pool, nil
}

func verifyCertChain(rawCerts [][]byte, roots *x509.CertPool) error {
	if len(rawCerts) == 0 {
		return fmt.Errorf("no peer certificates")
	}
	certs := make([]*x509.Certificate, len(rawCerts))
	for i, asn1Data := range rawCerts {
		cert, err := x509.ParseCertificate(asn1Data)
		if err != nil {
			return fmt.Errorf("parse peer certificate: %w", err)
		}
		certs[i] = cert
	}
	opts := x509.VerifyOptions{Roots: roots, Intermediates: x509.NewCertPool()}
	for _, cert := range certs[1:] {
		opts.Intermediates.AddCert(cert)
	}
	_, err := certs[0].Verify(opts)
	return err
}
