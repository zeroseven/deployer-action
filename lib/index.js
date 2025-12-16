"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const io = __importStar(require("@actions/io"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};
const log = {
    info: (msg) => core.info(`${colors.blue}${msg}${colors.reset}`),
    success: (msg) => core.info(`${colors.green}${msg}${colors.reset}`),
    warning: (msg) => core.warning(`${colors.yellow}${msg}${colors.reset}`),
    error: (msg) => core.error(`${colors.red}${msg}${colors.reset}`),
    title: (msg) => core.info(`${colors.cyan}${colors.bright}${msg}${colors.reset}`)
};
// Parse shell-like arguments handling quoted strings
function parseShellArgs(input) {
    const args = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if ((char === '"' || char === "'") && !inQuote) {
            inQuote = true;
            quoteChar = char;
        }
        else if (char === quoteChar && inQuote) {
            inQuote = false;
            quoteChar = '';
        }
        else if (char === ' ' && !inQuote) {
            if (current) {
                args.push(current);
                current = '';
            }
        }
        else {
            current += char;
        }
    }
    if (current) {
        args.push(current);
    }
    return args;
}
// Validate that a path is within a base directory (prevent path traversal)
function validatePathWithinBase(basePath, targetPath) {
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(basePath, targetPath);
    if (!resolvedTarget.startsWith(resolvedBase)) {
        throw new Error(`Path '${targetPath}' is outside the working directory`);
    }
}
async function getInputs() {
    return {
        sshPrivateKey: core.getInput('ssh-private-key', { required: true }),
        environment: core.getInput('environment', { required: true }),
        revision: core.getInput('revision', { required: true }),
        deployerBinary: core.getInput('deployer-binary'),
        sshKnownHosts: core.getInput('ssh-known-hosts'),
        sshPort: core.getInput('ssh-port'),
        workingDirectory: core.getInput('working-directory'),
        verbosity: core.getInput('verbosity'),
        options: core.getInput('options'),
        timeout: core.getInput('timeout')
    };
}
async function setupSSH(privateKey, knownHosts, port) {
    core.startGroup('Setting up SSH');
    const sshDir = path.join(os.homedir(), '.ssh');
    const tmpDir = os.tmpdir();
    const privateKeyPath = path.join(sshDir, 'deployer_action_key');
    const knownHostsPath = path.join(sshDir, 'deployer_action_known_hosts');
    const configPath = path.join(tmpDir, `ssh_config_deployer_${Date.now()}`);
    const controlPath = path.join(tmpDir, 'ssh_mux_%h_%p_%r');
    // Create .ssh directory
    await io.mkdirP(sshDir);
    await fs_1.promises.chmod(sshDir, 0o700);
    // Write private key
    await fs_1.promises.writeFile(privateKeyPath, privateKey + '\n', { mode: 0o600 });
    log.success('SSH private key configured');
    // Write known hosts or disable strict checking
    if (knownHosts) {
        await fs_1.promises.writeFile(knownHostsPath, knownHosts + '\n', { mode: 0o644 });
        log.success('SSH known hosts configured');
    }
    else {
        log.warning('No known_hosts provided. Using StrictHostKeyChecking=no (not recommended for production)');
    }
    // Create temporary SSH config with multiplexing for performance
    const sshConfig = `Host *
  StrictHostKeyChecking ${knownHosts ? 'yes' : 'no'}
  UserKnownHostsFile ${knownHosts ? knownHostsPath : '/dev/null'}
  IdentityFile ${privateKeyPath}
  Port ${port}
  ControlMaster auto
  ControlPath ${controlPath}
  ControlPersist 600
  ServerAliveInterval 60
  ServerAliveCountMax 3
`;
    await fs_1.promises.writeFile(configPath, sshConfig, { mode: 0o600 });
    log.success('SSH config created with connection multiplexing');
    // Export SSH config path for use in deployment
    core.exportVariable('GIT_SSH_COMMAND', `ssh -F ${configPath}`);
    // Start ssh-agent and add key
    const agentOutput = await exec.getExecOutput('ssh-agent', ['-s'], { silent: true });
    // Parse SSH_AUTH_SOCK and SSH_AGENT_PID from output with better error handling
    const authSockMatch = agentOutput.stdout.match(/SSH_AUTH_SOCK=([^;\s]+)/);
    const agentPidMatch = agentOutput.stdout.match(/SSH_AGENT_PID=([^;\s]+)/);
    if (!authSockMatch || !agentPidMatch) {
        throw new Error('Failed to parse ssh-agent output. Could not extract SSH_AUTH_SOCK or SSH_AGENT_PID.');
    }
    core.exportVariable('SSH_AUTH_SOCK', authSockMatch[1]);
    core.exportVariable('SSH_AGENT_PID', agentPidMatch[1]);
    // Add the key to ssh-agent
    await exec.exec('ssh-add', [privateKeyPath]);
    log.success('SSH agent started and key added');
    core.endGroup();
    // Return config path for cleanup
    return configPath;
}
async function verifyDeployerBinary(binaryPath, workingDir) {
    core.startGroup('Verifying Deployer');
    // Validate path is within working directory
    validatePathWithinBase(workingDir, binaryPath);
    const fullPath = path.join(workingDir, binaryPath);
    // Check if file exists first
    try {
        await fs_1.promises.access(fullPath, fs_1.promises.constants.F_OK);
    }
    catch {
        throw new Error(`Deployer binary not found at '${binaryPath}'. ` +
            `Make sure Deployer is installed via Composer or provide the correct path.`);
    }
    // Check if file is executable, make it executable if needed
    try {
        await fs_1.promises.access(fullPath, fs_1.promises.constants.X_OK);
    }
    catch {
        log.info(`Making ${binaryPath} executable...`);
        try {
            await fs_1.promises.chmod(fullPath, 0o755);
        }
        catch (chmodError) {
            throw new Error(`Failed to make ${binaryPath} executable: ${chmodError}`);
        }
    }
    // Verify Deployer works
    const { stdout, exitCode } = await exec.getExecOutput(binaryPath, ['--version'], {
        cwd: workingDir,
        ignoreReturnCode: true
    });
    if (exitCode !== 0 || !stdout) {
        throw new Error(`Failed to verify Deployer binary at '${binaryPath}'. ` +
            `The binary exists but could not be executed. Exit code: ${exitCode}`);
    }
    log.success(stdout.trim());
    core.endGroup();
}
async function runDeployment(deployerBinary, environment, revision, workingDir, verbosity, options, timeoutMs) {
    core.startGroup(`Deploying to ${environment}`);
    let deployerOutput = '';
    const args = ['deploy', environment, `--revision=${revision}`];
    // Add verbosity flag (simplified check - args is newly created so no duplicates possible)
    if (verbosity) {
        args.push(`-${verbosity}`);
    }
    // Add additional options with proper quote handling
    if (options) {
        const parsedOptions = parseShellArgs(options);
        args.push(...parsedOptions);
    }
    log.info(`Executing: ${deployerBinary} ${args.join(' ')}`);
    log.info(`Environment: ${environment}`);
    log.info(`Revision: ${revision}`);
    log.info(`Working directory: ${workingDir}`);
    if (timeoutMs) {
        log.info(`Timeout: ${timeoutMs}ms`);
    }
    // Setup timeout handling
    let timeoutHandle;
    const timeoutPromise = timeoutMs
        ? new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`Deployment timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        })
        : null;
    const execPromise = exec.exec(deployerBinary, args, {
        cwd: workingDir,
        ignoreReturnCode: true,
        listeners: {
            stdout: (data) => {
                const output = data.toString();
                deployerOutput += output;
                process.stdout.write(output);
            },
            stderr: (data) => {
                const output = data.toString();
                deployerOutput += output;
                process.stderr.write(output);
            }
        }
    });
    let exitCode;
    try {
        exitCode = timeoutPromise ? await Promise.race([execPromise, timeoutPromise]) : await execPromise;
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
    if (exitCode !== 0) {
        core.endGroup();
        throw new Error(`Deployer command failed with exit code ${exitCode}`);
    }
    log.success(`Successfully deployed to ${environment}`);
    core.endGroup();
    return deployerOutput;
}
async function cleanupSSH(configPath) {
    core.startGroup('Cleaning up SSH');
    const sshDir = path.join(os.homedir(), '.ssh');
    const tmpDir = os.tmpdir();
    const privateKeyPath = path.join(sshDir, 'deployer_action_key');
    const knownHostsPath = path.join(sshDir, 'deployer_action_known_hosts');
    // Remove private key
    try {
        await fs_1.promises.unlink(privateKeyPath);
        log.success('Removed private key');
    }
    catch (error) {
        core.debug(`Could not remove private key: ${error}`);
    }
    // Remove known hosts file
    try {
        await fs_1.promises.unlink(knownHostsPath);
        core.debug('Removed known hosts file');
    }
    catch (error) {
        core.debug(`Could not remove known hosts file: ${error}`);
    }
    // Remove temporary SSH config
    if (configPath) {
        try {
            await fs_1.promises.unlink(configPath);
            log.success('Removed temporary SSH config');
        }
        catch (error) {
            core.debug(`Could not remove SSH config: ${error}`);
        }
    }
    // Remove SSH control sockets
    try {
        const tmpFiles = await fs_1.promises.readdir(tmpDir);
        const controlSockets = tmpFiles.filter(f => f.startsWith('ssh_mux_'));
        for (const socket of controlSockets) {
            await fs_1.promises.unlink(path.join(tmpDir, socket)).catch(() => { });
        }
        if (controlSockets.length > 0) {
            log.success(`Removed ${controlSockets.length} SSH control socket(s)`);
        }
    }
    catch (error) {
        core.debug(`Could not clean control sockets: ${error}`);
    }
    // Kill ssh-agent
    const agentPid = process.env.SSH_AGENT_PID;
    if (agentPid) {
        try {
            await exec.exec('ssh-agent', ['-k'], { ignoreReturnCode: true });
            log.success('SSH agent terminated');
        }
        catch (error) {
            core.debug(`Could not kill ssh-agent: ${error}`);
        }
    }
    core.endGroup();
}
async function run() {
    let sshConfigPath;
    try {
        const inputs = await getInputs();
        log.title(`Deploying to environment: ${inputs.environment}`);
        log.info(`Revision: ${inputs.revision}`);
        // Setup SSH
        sshConfigPath = await setupSSH(inputs.sshPrivateKey, inputs.sshKnownHosts, inputs.sshPort);
        // Verify Deployer binary
        await verifyDeployerBinary(inputs.deployerBinary, inputs.workingDirectory);
        // Parse timeout value
        const timeoutMs = inputs.timeout ? parseInt(inputs.timeout, 10) : undefined;
        if (timeoutMs && (isNaN(timeoutMs) || timeoutMs <= 0)) {
            throw new Error(`Invalid timeout value: ${inputs.timeout}. Must be a positive number in milliseconds.`);
        }
        // Run deployment
        const output = await runDeployment(inputs.deployerBinary, inputs.environment, inputs.revision, inputs.workingDirectory, inputs.verbosity, inputs.options, timeoutMs);
        // Set outputs
        core.setOutput('deployment-status', 'success');
        core.setOutput('deployer-output', output);
        // Cleanup
        await cleanupSSH(sshConfigPath);
        log.success('Deployment completed successfully!');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        core.setFailed(`Action failed: ${errorMessage}`);
        core.setOutput('deployment-status', 'failed');
        // Ensure cleanup even on failure
        try {
            await cleanupSSH(sshConfigPath);
        }
        catch (cleanupError) {
            core.debug(`Cleanup error: ${cleanupError}`);
        }
    }
}
run();
//# sourceMappingURL=index.js.map