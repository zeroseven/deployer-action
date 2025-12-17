# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **GitHub Action** implemented in TypeScript that deploys PHP projects using [Deployer](https://deployer.org/) over SSH. The action is a single-file implementation (`src/index.ts`) that compiles to Node.js 20 and is distributed via the compiled `dist/` directory.

**Key point**: This is a GitHub Action for PHP projects, not a Node.js project itself. It orchestrates SSH setup, Deployer verification, and deployment execution.

## Development Commands

### Build and Package
```bash
npm run build           # Compile TypeScript to lib/
npm run package         # Bundle to dist/index.js using @vercel/ncc
npm run all             # Build, format, lint, and package (use before commits)
```

### Quality Checks
```bash
npm run format          # Format TypeScript files with Prettier
npm run format-check    # Check formatting without modifying
npm run lint            # Run ESLint
npm run ci              # Run all CI checks locally (build, format-check, lint, package)
```

### Release
```bash
npm run release         # Run semantic-release (requires GITHUB_TOKEN)
npm run release -- --dry-run  # Preview release without publishing
```

## Architecture

### Single-File Design
The entire action logic is in `src/index.ts` (~400 lines). There are no separate modules. The file follows this flow:

1. **Input collection** (`getInputs()`) - Read action inputs from action.yml
2. **SSH setup** (`setupSSH()`) - Configure ssh-agent, write keys/config, enable multiplexing
3. **Deployer verification** (`verifyDeployerBinary()`) - Validate and chmod the Deployer binary
4. **Deployment execution** (`runDeployment()`) - Run `dep deploy` with proper argument handling
5. **Cleanup** (`cleanupSSH()`) - Remove SSH artifacts and kill ssh-agent

### SSH Configuration Strategy
The action creates a temporary SSH config file with:
- **Multiplexing** enabled (`ControlMaster auto`) for performance
- **StrictHostKeyChecking** conditional on whether `ssh-known-hosts` is provided
- Custom identity file and known_hosts paths in `~/.ssh/deployer_action_*`
- Config exported via `GIT_SSH_COMMAND` environment variable

SSH artifacts are cleaned up in a `finally` block to ensure removal even on failure.

### Security Features
- **Path traversal protection** (`validatePathWithinBase()`) prevents deployer-binary input from escaping working directory
- **Shell argument parsing** (`parseShellArgs()`) handles quoted strings in the `options` input
- **File permissions**: SSH directory (0700), private key (0600), SSH config (0600)
- Private keys never logged; cleaned up after execution

### Timeout Handling
The action supports an optional `timeout` input (milliseconds). Implementation uses `Promise.race()` between the Deployer execution and a timeout promise, with proper cleanup of the timeout handle.

## Important Implementation Details

### Deployer Binary Path
The `deployer-binary` input defaults to `vendor/bin/dep` (PHP/Composer convention). The action:
1. Validates the path is within `working-directory`
2. Checks file existence and executability
3. Runs `--version` to verify it's a working Deployer binary
4. Automatically chmod's the file to 0755 if not executable

### Argument Handling
The `options` input is parsed using `parseShellArgs()` which respects quoted strings (e.g., `"--parallel --limit=10"` or `'--tag="v1.0"'`). This prevents shell injection while allowing complex arguments.

The `verbosity` input accepts `v`, `vv`, or `vvv` and is converted to `-v`, `-vv`, or `-vvv` before passing to Deployer.

### Output Streaming
Deployer output is:
- Streamed to GitHub Actions logs in real-time (via `process.stdout.write()` in exec listeners)
- Accumulated in a string buffer for the `deployer-output` action output
- Includes both stdout and stderr

### Error Handling
The action always sets `deployment-status` output to `success` or `failed`, even when the action itself fails. Cleanup runs in a `finally` block to ensure SSH artifacts are removed.

## Distribution Model

**Critical**: The `dist/` directory is checked into git and must be kept up-to-date.

- Users consume the action via `zeroseven/deployer-action@v1` which reads `dist/index.js`
- After any `src/` changes, run `npm run package` and commit `dist/`
- CI verifies `dist/` is up-to-date on every push (see `.github/workflows/ci.yml:39-47`)

## Release Process

This project uses **semantic-release** with Conventional Commits:

- `fix:` → patch version (e.g., 1.0.1)
- `feat:` → minor version (e.g., 1.1.0)
- `feat!:`, `fix!:`, or `BREAKING CHANGE:` footer → major version (e.g., 2.0.0)

The release workflow:
1. Triggers automatically when CI passes on `main` branch
2. Can be triggered manually via workflow_dispatch
3. Creates a Git tag (e.g., `v1.0.1`) and GitHub Release
4. Updates floating major tag (e.g., `v1`) to point to the new release

Configuration is in `.releaserc.json`.

## Testing Strategy

This action has no automated tests. Changes should be tested by:
1. Running `npm run ci` locally to verify compilation and formatting
2. Testing in a real GitHub Actions workflow with a PHP project that has Deployer installed

## Action Inputs/Outputs Reference

**Inputs** (from action.yml):
- `ssh-private-key` (required) - SSH private key content
- `environment` (required) - Deployer environment (e.g., production, staging)
- `revision` (required) - Git commit SHA
- `deployer-binary` (default: vendor/bin/dep) - Path to Deployer binary
- `ssh-known-hosts` (optional) - Known hosts file content for strict checking
- `ssh-port` (default: 22) - SSH port
- `working-directory` (default: .) - Directory containing deploy.php
- `verbosity` (optional) - Deployer verbosity (v, vv, vvv)
- `options` (optional) - Additional Deployer CLI options
- `timeout` (optional) - Timeout in milliseconds

**Outputs**:
- `deployment-status` - Either "success" or "failed"
- `deployer-output` - Full stdout/stderr from Deployer

## Code Style

- TypeScript with strict mode enabled
- Prettier for formatting (no semicolons by default - check .prettierrc if exists)
- ESLint with GitHub plugin rules
- ANSI color codes for console output (see `colors` object and `log` utilities at top of index.ts)