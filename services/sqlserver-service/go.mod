module niuma/services/sqlserver-service

go 1.25.7

require (
	github.com/microsoft/go-mssqldb v1.10.0
	niuma/pkg/common v0.0.0
	niuma/pkg/logutil v0.0.0
	niuma/pkg/netproxy v0.0.0
	niuma/pkg/serviceipc v0.0.0
	niuma/pkg/sqllsp v0.0.0
	niuma/pkg/tunnel v0.0.0
)

require (
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/golang-sql/civil v0.0.0-20220223132316-b832511892a9 // indirect
	github.com/golang-sql/sqlexp v0.1.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/shopspring/decimal v1.4.0 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
)

replace niuma/pkg/common => ../../packages/go/common

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/netproxy => ../../packages/go/netproxy

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc

replace niuma/pkg/sqllsp => ../../packages/go/sqllsp

replace niuma/pkg/tunnel => ../../packages/go/tunnel
