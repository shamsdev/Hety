# Hety

<p align="center">
  <img src="assets/logo.png" alt="Hety logo" width="160" />
</p>

Hety is an all-in-one desktop developer cockpit for managing SSH sessions, Git repositories, and PostgreSQL databases from one project-based workspace.

Built with Electron, React, TypeScript, Vite, and Tailwind CSS.

## Features

- Project dashboard with groups, tags, search, and recent projects.
- Per-project SSH servers, Git repository paths, and PostgreSQL database connections.
- Multi-tab SSH terminals powered by xterm.js with password, key, and keyboard-interactive authentication.
- Remote tab for managing any saved SSH server without leaving the app:
  - **Files** — SFTP browser with breadcrumbs, upload (button or drag-and-drop), download (folders arrive as `.tar.gz`), rename, copy/move, delete, permissions and owner, compress/extract, an in-place text editor, an image preview, and a follow-the-tail log viewer. Right-click a row for per-file actions or empty space for folder actions.
  - **Monitor** — live CPU (total and per core), memory, swap, load, uptime, temperature, per-filesystem usage, network throughput, logged-in sessions, and a top-processes table with term/kill.
  - **Security** — ufw status with rule add/delete/enable/disable, listening ports (with one-click "allow in ufw"), an `sshd -T` hardening audit, fail2ban jails with unban, recent accepted/failed logins, and a pending-updates check.
  - **Services** — systemd units with start, stop, restart, enable/disable at boot, and `journalctl` output.
  - **Docker** — containers and images with start/stop/restart/remove, logs, and prune.

  Servers carry an optional **sudo password**; when the login account is not root, Hety uses it to elevate the actions that need it (firewall, services, root-owned files, uploads into protected directories) instead of making you run `sudo su` in a terminal.
- Git workspace tools for branch switching, fetch, pull, push, staging, unstaging, committing, and recent history.
- PostgreSQL schema browser for schemas, tables, views, enums, and columns.
- Multi-tab SQL console with CodeMirror autocomplete, saved queries, editable table views, and result export to Markdown, CSV, or TSV.
- Connection testing before saving SSH and database settings.
- Encrypted local storage with AES-256-GCM and optional master password protection.

## Tech Stack

- Electron + electron-vite
- React 18 + TypeScript
- Tailwind CSS
- Zustand
- simple-git
- ssh2
- pg
- CodeMirror
- xterm.js

## Requirements

- Node.js 18 or newer
- Git available on `PATH` for repository features
- PostgreSQL access for database connections
- SSH access for remote terminal and tunnel features
- A Linux host for the Remote tab; privileged actions (firewall, services, some paths) need root or `sudo`

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

## Build

Type-check the main, preload, and renderer code:

```bash
npm run typecheck
```

Build the app into `out`:

```bash
npm run build
```

Create a distributable package with electron-builder:

```bash
npm run pack
```

## Local Data

Hety stores its local app data in Electron's `userData` directory as `hety-data.dat`. When a master password is set, the data file is encrypted locally with AES-256-GCM.

## Project Structure

```text
src/main       Electron main process, IPC, local storage, SSH/Git/DB handlers
src/preload    Safe API bridge exposed to the renderer
src/renderer   React application, panels, dialogs, and UI components
src/shared     Shared TypeScript types
assets         Project images and branding assets
```

## GitHub Description

All-in-one desktop developer cockpit for SSH terminals, Git workflows, and PostgreSQL databases.

## License

MIT
