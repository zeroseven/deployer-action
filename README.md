# zeroseven/deployer-action

Composite GitHub Action for deploying PHP projects using Deployer over SSH.

This action sets up SSH securely, verifies your Deployer binary, and runs a deployment to a specified environment and revision. It streams Deployer output to the job log and exposes useful outputs you can consume in later steps.

Note: Although this action is implemented in Node.js, it targets PHP projects that use Deployer (`dep`) and a `deploy.php` recipe in your repository.

---

### Features
- Sets up SSH agent with your provided private key
- Optional strict host key checking via `ssh-known-hosts`
- Verifies your Deployer binary (default `vendor/bin/dep`)
- Runs `dep deploy <environment> --revision=<hash>` with optional verbosity and extra options
- Cleans up SSH artifacts after the run
- Exposes deployment status and full Deployer output as action outputs

---

## Quick start

Prerequisites:
- A PHP project with [Deployer](https://deployer.org/) installed (usually via Composer) and a `deploy.php` file in your repo.
- An SSH private key with access to your deployment targets.
- Optionally: Known host entries for strict host key checking.

Basic usage example:

```yaml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Composer dependencies
        uses: php-actions/composer@v6
        with:
          php_version: '8.2'

      - name: Deploy with Deployer
        uses: zeroseven/deployer-action@v1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          environment: production
          revision: ${{ github.sha }}
```

Tip: Replace `@v1` with a pinned commit SHA for maximum supply-chain security in your organization.

---

## Inputs

All inputs map directly to the action’s `action.yml`.

- `ssh-private-key` (required)
  - Your private key contents. Prefer a repository or organization secret (e.g., `secrets.DEPLOY_SSH_PRIVATE_KEY`). The action loads the key into `ssh-agent` and uses SSH multiplexing for performance.

- `environment` (required)
  - The Deployer target/environment to deploy to (e.g., `staging`, `testing`, `production`). Used as `dep deploy <environment>`.

- `revision` (required)
  - Git revision hash to deploy. Commonly `${{ github.sha }}`.

- `deployer-binary` (default: `vendor/bin/dep`)
  - Path to your Deployer binary relative to `working-directory`. The action verifies it and ensures it is executable.

- `ssh-known-hosts` (default: empty)
  - The content for your `known_hosts` file. If provided, strict host key checking is enabled. If omitted, the action sets `StrictHostKeyChecking=no` (not recommended for production).

- `ssh-port` (default: `22`)
  - SSH port to use for connections.

- `working-directory` (default: `.`)
  - Directory where your `deploy.php` and `deployer-binary` reside. Commands run with this as the current working directory.

- `verbosity` (default: empty)
  - Deployer verbosity level. Pass just `v`, `vv`, or `vvv` and the action converts it to `-v`, `-vv`, or `-vvv` respectively.

- `options` (default: empty)
  - Additional Deployer CLI options, e.g., `"--parallel --limit=10"`. The string is split on spaces and appended to the command.

---

## Outputs

- `deployment-status`
  - `success` or `failed` depending on the execution. Set even when the action fails.

- `deployer-output`
  - Full combined stdout/stderr from the Deployer run. Can be lengthy; consider saving to an artifact only when needed.

Example of consuming outputs:

```yaml
      - name: Deploy
        id: deploy
        uses: zeroseven/deployer-action@v1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          environment: staging
          revision: ${{ github.sha }}

      - name: Use outputs in a later step
        if: ${{ success() }}
        run: |
          echo "Deployment completed. See previous step logs for details."
          # To consume outputs in expressions, reference:
          # steps.deploy.outputs['deployment-status']  (success|failed)
          # steps.deploy.outputs['deployer-output']    (full logs)
```

---

## Advanced examples

Provide known hosts for strict checking:

```yaml
      - name: Deploy with strict host key checking
        uses: zeroseven/deployer-action@v1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          ssh-known-hosts: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          environment: production
          revision: ${{ github.sha }}
```

Custom SSH port and working directory:

```yaml
      - name: Deploy to custom port from subdir
        uses: zeroseven/deployer-action@v1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          ssh-known-hosts: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          ssh-port: '2222'
          working-directory: app
          environment: testing
          revision: ${{ github.sha }}
```

Increase verbosity and pass extra options:

```yaml
      - name: Verbose parallel deploy
        uses: zeroseven/deployer-action@v1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}
          environment: staging
          revision: ${{ github.sha }}
          verbosity: vvv
          options: "--parallel --limit=5"
```

---

## Security best practices

- Always store your SSH private key and known hosts in GitHub Secrets (or higher-scope secrets) and never commit them to the repository.
- Prefer providing `ssh-known-hosts` for production to enable strict host key checking.
- Pin the action version to a major tag you control (e.g., `@v1`) or better a specific commit SHA.
- Limit the key’s privileges and consider using deploy-only users on your target hosts.

---

## Troubleshooting

- Deployer not found / verification failed
  - Ensure Composer dependencies are installed and `vendor/bin/dep` exists, or set `deployer-binary` to the correct path. You can add a step like `php-actions/composer@v6` before this action.

- SSH host key verification failed
  - Provide `ssh-known-hosts` and ensure the entry matches your host and key type. Generate with: `ssh-keyscan -p <port> <host>`.

- Permission denied (publickey)
  - Verify the provided private key has access to the target server and is correctly formatted. Ensure there are no passphrases that require interactive input.

- Non-zero Deployer exit code
  - Check the job logs for the exact failing task. You can increase `verbosity` to `vvv` for more detail.

---

## Contributing

We welcome contributions! To set up a local dev environment:

1. Prerequisites
   - Node.js 20+
   - npm 9+
   - Optional: A sample repo with `deploy.php` for end-to-end tests

2. Install and build
   - `npm ci`
   - `npm run all` (type-check, format, and package to `dist/`)

3. Lint/format
   - `npm run lint`
   - `npm run format`
   - Or run all CI checks locally: `npm run ci`

4. Packaging
   - The published action uses the compiled files in `dist/`. After changes in `src/`, run `npm run package` and commit the updated `dist/` folder.

5. Updating inputs/outputs
   - If you change `action.yml` inputs or outputs, update this README accordingly and bump the version tag in release instructions.

6. Pull requests
   - Describe the change and motivation
   - Include before/after behavior
   - Keep changes focused; separate functional changes from formatting when possible

7. Releasing
   - Create a release and move the `v1` tag to the new commit if following semver major tagging.

---

## License

Licensed under the MIT License. You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies under the terms of the MIT license.
If you need the full text, include it in a `LICENSE` file or see https://opensource.org/licenses/MIT.
