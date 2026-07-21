module niuma/services/mysql-service

go 1.25.0

require (
	github.com/go-sql-driver/mysql v1.9.3
	niuma/pkg/logutil v0.0.0
	niuma/pkg/netproxy v0.0.0
	niuma/pkg/serviceipc v0.0.0
	niuma/pkg/tunnel v0.0.0
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/Microsoft/go-winio v0.6.2 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/netproxy => ../../packages/go/netproxy

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc

replace niuma/pkg/tunnel => ../../packages/go/tunnel
