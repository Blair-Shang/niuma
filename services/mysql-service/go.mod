module niuma/services/mysql-service

go 1.25.0

require (
	github.com/go-sql-driver/mysql v1.9.3
	github.com/pingcap/tidb/pkg/parser v0.0.0-20260727071003-bd29ad1ac3fd
	niuma/pkg/common v0.0.0
	niuma/pkg/logutil v0.0.0
	niuma/pkg/netproxy v0.0.0
	niuma/pkg/serviceipc v0.0.0
	niuma/pkg/sqllsp v0.0.0
	niuma/pkg/tunnel v0.0.0
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/coreos/go-semver v0.3.1 // indirect
	github.com/pingcap/errors v0.11.5-0.20250523034308-74f78ae071ee // indirect
	github.com/pingcap/failpoint v0.0.0-20240528011301-b51a646c7c86 // indirect
	github.com/pingcap/log v1.1.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	gopkg.in/natefinch/lumberjack.v2 v2.2.1 // indirect
)

replace niuma/pkg/common => ../../packages/go/common

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/netproxy => ../../packages/go/netproxy

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc

replace niuma/pkg/sqllsp => ../../packages/go/sqllsp

replace niuma/pkg/tunnel => ../../packages/go/tunnel
