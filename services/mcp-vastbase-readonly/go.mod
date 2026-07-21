module niuma/services/mcp-vastbase-readonly

go 1.25.0

require niuma/pkg/serviceipc v0.0.0

require (
	github.com/Microsoft/go-winio v0.6.2 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc
