module niuma/services/api-service

go 1.25.0

require (
	niuma/pkg/common v0.0.0
	niuma/pkg/logutil v0.0.0
	niuma/pkg/serviceipc v0.0.0
)

require (
	github.com/Microsoft/go-winio v0.6.2 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace niuma/pkg/common => ../../packages/go/common

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc
