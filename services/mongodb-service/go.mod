module niuma/services/mongodb-service

go 1.25.0

require (
	github.com/creack/pty v1.1.24
	go.mongodb.org/mongo-driver v1.17.4
	niuma/pkg/logutil v0.0.0
	niuma/pkg/netproxy v0.0.0
	niuma/pkg/serviceipc v0.0.0
	niuma/pkg/tunnel v0.0.0-00010101000000-000000000000
)

require (
	github.com/Microsoft/go-winio v0.6.2 // indirect
	github.com/golang/snappy v0.0.4 // indirect
	github.com/klauspost/compress v1.16.7 // indirect
	github.com/montanaflynn/stats v0.7.1 // indirect
	github.com/xdg-go/pbkdf2 v1.0.0 // indirect
	github.com/xdg-go/scram v1.1.2 // indirect
	github.com/xdg-go/stringprep v1.0.4 // indirect
	github.com/youmark/pkcs8 v0.0.0-20240726163527-a2c0da244d78 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
)

replace niuma/pkg/logutil => ../../packages/go/logutil

replace niuma/pkg/netproxy => ../../packages/go/netproxy

replace niuma/pkg/serviceipc => ../../packages/go/serviceipc

replace niuma/pkg/tunnel => ../../packages/go/tunnel
