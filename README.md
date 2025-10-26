# CDN Explorer

A lightweight Node.js file explorer that powers private CDN browsing. It serves directory listings using a static HTML template and supports direct file downloads via signed routes.

## Features

- Clean, responsive directory listings styled through `template.html`
- Breadcrumb navigation with automatic parent links
- One-click downloads for files while keeping directories navigable
- Legacy query support for `?path=` and `/download?path=` routes
- Works entirely with Node.js core modules (no dependencies)

## Getting Started

### Prerequisites

- Node.js v16 or newer (uses `fs.promises` and modern Intl formatting)
- Files to expose under the explorer root

### Installation

Clone the repository and install dependencies (none required):

```bash
node --version
npm install  # optional; no packages required
```

### Configuration

Environment variables control runtime behavior:

- `PORT` (default `10080`): TCP port the service listens on
- `HOST` (default `0.0.0.0`): Bind address
- `EXPLORER_ROOT` (default `./explorer` under repo): Root directory to serve

### Usage

```bash
# serve the current directory
EXPLORER_ROOT=/path/to/cdn node server.js

# or wrap with pm2/systemd/tmux for background operation
```

Point your reverse proxy (e.g., Nginx) at the chosen host and port. Ensure `/explorer/` paths are proxied so relative links remain intact.

## Template Customization

The HTML layout lives in `template.html`. The server replaces these placeholders at runtime:

- `{{breadcrumbs}}`
- `{{files}}`
- `{{year}}`

Adapt the template to match your brand while keeping the placeholders intact.

## Development Notes

- Directory traversal is prevented by normalizing and validating request paths
- MIME types are derived from file extensions with sane fallbacks
- Directory listings include file counts and human-readable sizes

## License

MIT
