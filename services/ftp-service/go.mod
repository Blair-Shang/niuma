module niuma/services/ftp-service

go 1.25.0

require (
	github.com/jlaffaye/ftp v0.2.0
	niuma/pkg/buildinfo v0.0.0
	niuma/pkg/logutil v0.0.0
	niuma/pkg/netproxy v0.0.0
	niuma/pkg/serviceipc v0.0.0
)

require (
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/hashicorp/errwrap v1.0.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
)

replace niuma/pkg/buildinfo => ../../packages/go/buildinfo

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/netproxy => ../../packages/go/netproxy

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc
