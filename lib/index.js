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
        options: core.getInput('options')
    };
}
async function setupSSH(privateKey, knownHosts, port) {
    core.startGroup('Setting up SSH');
    const sshDir = path.join(os.homedir(), '.ssh');
    const privateKeyPath = path.join(sshDir, 'id_rsa');
    const knownHostsPath = path.join(sshDir, 'known_hosts');
    const configPath = path.join(sshDir, 'config');
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
    // Create SSH config with multiplexing for performance
    const sshConfig = `Host *
  StrictHostKeyChecking ${knownHosts ? 'yes' : 'no'}
  UserKnownHostsFile ${knownHosts ? knownHostsPath : '/dev/null'}
  IdentityFile ${privateKeyPath}
  Port ${port}
  ControlMaster auto
  ControlPath /tmp/ssh_mux_%h_%p_%r
  ControlPersist 600
  ServerAliveInterval 60
  ServerAliveCountMax 3
`;
    await fs_1.promises.writeFile(configPath, sshConfig, { mode: 0o600 });
    log.success('SSH config created with connection multiplexing');
    // Start ssh-agent and add key
    const agentOutput = await exec.getExecOutput('ssh-agent', ['-s']);
    // Parse SSH_AUTH_SOCK and SSH_AGENT_PID from output
    const authSockMatch = agentOutput.stdout.match(/SSH_AUTH_SOCK=([^;]+)/);
    const agentPidMatch = agentOutput.stdout.match(/SSH_AGENT_PID=([^;]+)/);
    if (authSockMatch) {
        core.exportVariable('SSH_AUTH_SOCK', authSockMatch[1]);
    }
    if (agentPidMatch) {
        core.exportVariable('SSH_AGENT_PID', agentPidMatch[1]);
    }
    // Add the key to ssh-agent
    await exec.exec('ssh-add', [privateKeyPath]);
    log.success('SSH agent started and key added');
    core.endGroup();
}
async function verifyDeployerBinary(binaryPath, workingDir) {
    core.startGroup('Verifying Deployer');
    const fullPath = path.join(workingDir, binaryPath);
    // Check if file exists and make it executable if needed
    try {
        await fs_1.promises.access(fullPath, fs_1.promises.constants.X_OK);
    }
    catch {
        // Try to make it executable
        log.info(`Making ${binaryPath} executable...`);
        await fs_1.promises.chmod(fullPath, 0o755);
    }
    // Verify Deployer works
    const { stdout, exitCode } = await exec.getExecOutput(binaryPath, ['--version'], {
        cwd: workingDir,
        ignoreReturnCode: true
    });
    if (exitCode !== 0 || !stdout) {
        throw new Error(`Failed to verify Deployer binary at '${binaryPath}'. ` +
            `Make sure Deployer is installed via Composer or provide the correct path.`);
    }
    log.success(stdout.trim());
    core.endGroup();
}
async function runDeployment(deployerBinary, environment, revision, workingDir, verbosity, options) {
    core.startGroup(`Deploying to ${environment}`);
    let deployerOutput = '';
    const args = ['deploy', environment, `--revision=${revision}`];
    // Add verbosity flag
    if (verbosity && !args.includes('-v') && !args.includes('-vv') && !args.includes('-vvv')) {
        args.push(`-${verbosity}`);
    }
    // Add additional options
    if (options) {
        args.push(...options.split(' ').filter(opt => opt.trim()));
    }
    log.info(`Executing: ${deployerBinary} ${args.join(' ')}`);
    log.info(`Environment: ${environment}`);
    log.info(`Revision: ${revision}`);
    log.info(`Working directory: ${workingDir}`);
    const exitCode = await exec.exec(deployerBinary, args, {
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
    if (exitCode !== 0) {
        core.endGroup();
        throw new Error(`Deployer command failed with exit code ${exitCode}`);
    }
    log.success(`Successfully deployed to ${environment}`);
    core.endGroup();
    return deployerOutput;
}
async function cleanupSSH() {
    core.startGroup('Cleaning up SSH');
    const sshDir = path.join(os.homedir(), '.ssh');
    const privateKeyPath = path.join(sshDir, 'id_rsa');
    // Remove private key
    try {
        await fs_1.promises.unlink(privateKeyPath);
        log.success('Removed private key');
    }
    catch (error) {
        core.debug(`Could not remove private key: ${error}`);
    }
    // Remove SSH control sockets
    try {
        const tmpFiles = await fs_1.promises.readdir('/tmp');
        const controlSockets = tmpFiles.filter(f => f.startsWith('ssh_mux_'));
        for (const socket of controlSockets) {
            await fs_1.promises.unlink(path.join('/tmp', socket)).catch(() => { });
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
    try {
        const inputs = await getInputs();
        log.title(`Deploying to environment: ${inputs.environment}`);
        log.info(`Revision: ${inputs.revision}`);
        // Setup SSH
        await setupSSH(inputs.sshPrivateKey, inputs.sshKnownHosts, inputs.sshPort);
        // Verify Deployer binary
        await verifyDeployerBinary(inputs.deployerBinary, inputs.workingDirectory);
        // Run deployment
        const output = await runDeployment(inputs.deployerBinary, inputs.environment, inputs.revision, inputs.workingDirectory, inputs.verbosity, inputs.options);
        // Set outputs
        core.setOutput('deployment-status', 'success');
        core.setOutput('deployer-output', output);
        // Cleanup
        await cleanupSSH();
        log.success('Deployment completed successfully!');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        core.setFailed(`Action failed: ${errorMessage}`);
        core.setOutput('deployment-status', 'failed');
        // Ensure cleanup even on failure
        try {
            await cleanupSSH();
        }
        catch (cleanupError) {
            core.debug(`Cleanup error: ${cleanupError}`);
        }
    }
}
run();
//# sourceMappingURL=index.js.map