Place Oracle Instant Client (Basic or Basic Light) files here (oci.dll / libclntsh, etc.).
See docs/29-oracle-module.md and services/oracle-service/README.md.

Product default: Instant Client is NOT bundled into installers.
Prefer ORACLE_HOME / PATH, or Settings → Tool Components → Oracle Instant Client.

Dev-only sidecar: local Instant Client DLLs under this folder must NOT be staged
into production packages (stage-services copies README/.gitkeep only).
