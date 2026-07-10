module niuma/pkg/tunnel

go 1.25.0

replace niuma/pkg/netproxy => ../netproxy

require (
	golang.org/x/crypto v0.54.0
	niuma/pkg/netproxy v0.0.0-00010101000000-000000000000
)

require (
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
)
