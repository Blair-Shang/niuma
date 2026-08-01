package session

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"
)

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

func loadClientCerts(certPath, keyPath string) ([]tls.Certificate, error) {
	certPath = strings.TrimSpace(certPath)
	keyPath = strings.TrimSpace(keyPath)
	if certPath == "" && keyPath == "" {
		return nil, nil
	}
	if certPath == "" || keyPath == "" {
		return nil, fmt.Errorf("ssl_cert and ssl_key must both be set")
	}
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("ssl client cert: %w", err)
	}
	return []tls.Certificate{pair}, nil
}

// buildTLSConfig 按 ssl_mode 与证书路径构造 TLS 配置。
// serverName 用于 verify-full 主机名校验（通常为连接 host）。
func buildTLSConfig(opts ConnectOptions, serverName string) (*tls.Config, error) {
	mode := strings.ToLower(strings.TrimSpace(opts.SSLMode))
	rootPool, err := loadCertPool(opts.SSLCA)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: ssl_ca: %w", err)
	}
	certs, err := loadClientCerts(opts.SSLCert, opts.SSLKey)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: %w", err)
	}

	cfg := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		RootCAs:      rootPool,
		Certificates: certs,
	}

	switch mode {
	case "", "require", "required", "true":
		cfg.InsecureSkipVerify = true //nolint:gosec // require：加密优先
	case "verify-ca", "verify_ca":
		if rootPool == nil {
			return nil, fmt.Errorf("clickhouse: verify-ca requires ssl_ca")
		}
		pool := rootPool
		cfg.InsecureSkipVerify = true //nolint:gosec // 主机名跳过；链校验见 VerifyPeerCertificate
		cfg.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			return verifyCertChain(rawCerts, pool)
		}
	case "verify-full", "verify_identity", "verify-identity":
		if rootPool == nil {
			return nil, fmt.Errorf("clickhouse: verify-full requires ssl_ca")
		}
		cfg.InsecureSkipVerify = false
		cfg.ServerName = strings.TrimSpace(serverName)
	default:
		cfg.InsecureSkipVerify = true //nolint:gosec
	}
	return cfg, nil
}
