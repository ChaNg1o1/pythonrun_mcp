#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, constants as fsConstants } from 'fs';
import { glob } from 'glob';
import * as fs from 'fs/promises';
import { createHash, randomBytes } from 'crypto';
import { homedir } from 'os';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration management
class Config {
  constructor() {
    this.settings = {
      maxExecutionTime: parseInt(process.env.MCP_PYTHON_TIMEOUT) || 30000,
      maxMemoryMB: parseInt(process.env.MCP_MAX_MEMORY_MB) || 512,
      maxOutputSize: parseInt(process.env.MCP_MAX_OUTPUT_SIZE) || 10000000, // 10MB
      allowedPackages: [], // No package restrictions
      blockedPackages: [], // No blocked packages
      workspaceDir: process.env.MCP_WORKSPACE_DIR || join(__dirname, '..', 'workspace'),
      enableSandbox: false, // Disable sandbox
      logLevel: process.env.MCP_LOG_LEVEL || 'info'
    };
  }

  get(key) {
    return this.settings[key];
  }

  getAll() {
    return { ...this.settings };
  }
}

// Logger class for better error handling
class Logger {
  constructor(level = 'info') {
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.level = this.levels[level] || 2;
  }

  error(message, error = null) {
    if (this.level >= 0) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
      if (error && error.stack) {
        console.error(error.stack);
      }
    }
  }

  warn(message) {
    if (this.level >= 1) {
      console.error(`[WARN] ${new Date().toISOString()} - ${message}`);
    }
  }

  info(message) {
    if (this.level >= 2) {
      console.error(`[INFO] ${new Date().toISOString()} - ${message}`);
    }
  }

  debug(message) {
    if (this.level >= 3) {
      console.error(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    }
  }
}

class MCPServer {
  constructor() {
    this.config = new Config();
    this.logger = new Logger(this.config.get('logLevel'));
    
    this.server = new Server(
      {
        name: 'mcp-python-server',
        version: '2.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.workDir = this.config.get('workspaceDir');
    this.venvDir = join(this.workDir, 'venv');
    
    this.setupHandlers();
    this.setupWorkspace();
    
    this.logger.info('MCP Python Server initialized (simplified mode)');
  }

  setupWorkspace() {
    try {
      // Create workspace directory
      if (!existsSync(this.workDir)) {
        mkdirSync(this.workDir, { recursive: true });
        this.logger.info(`Created workspace directory: ${this.workDir}`);
      }
      
    } catch (error) {
      this.logger.error('Failed to setup workspace', error);
      throw error;
    }
  }

  // Input validation and security - simplified to allow all operations
  validatePythonCode(code) {
    // Allow all operations - no security restrictions
    return true;
  }

  validatePackages(packages) {
    // Allow all packages - no restrictions
    return true;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Python Tools - Execute Python code and manage packages easily
          {
            name: 'python_execute',
            description: 'Execute Python code. Automatically installs packages if specified in requirements.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Python code to execute',
                },
                setup_venv: {
                  type: 'boolean',
                  description: 'Reset the virtual environment before execution',
                  default: false,
                },
                requirements: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Python packages to install before running code (e.g. ["numpy", "matplotlib"])',
                  default: [],
                },
              },
              required: ['code'],
            },
          },
          {
            name: 'python_install_package',
            description: 'Install Python packages using pip. Packages persist across code executions.',
            inputSchema: {
              type: 'object',
              properties: {
                packages: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of package names to install (e.g. ["sympy", "pandas"])',
                },
              },
              required: ['packages'],
            },
          },
          {
            name: 'python_list_packages',
            description: 'List all currently installed Python packages',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: 'python_reset_environment',
            description: 'Reset the Python environment (removes all packages and recreates virtual env)',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          // File Operations - Simple file management
          {
            name: 'file_create',
            description: 'Create a new file with content. Use this to save code, data, or any text content.',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'File path (e.g., "script.py", "data/output.txt")',
                },
                content: {
                  type: 'string',
                  description: 'Content to write to the file',
                  default: '',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'file_read',
            description: 'Read and return file contents. Perfect for loading code, data, or configuration files.',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to read',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'file_move',
            description: 'Move or rename a file',
            inputSchema: {
              type: 'object',
              properties: {
                source: {
                  type: 'string',
                  description: 'Source file path',
                },
                destination: {
                  type: 'string',
                  description: 'Destination file path',
                },
              },
              required: ['source', 'destination'],
            },
          },
          {
            name: 'file_delete',
            description: 'Delete a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to delete',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'file_copy',
            description: 'Copy a file or directory',
            inputSchema: {
              type: 'object',
              properties: {
                source: {
                  type: 'string',
                  description: 'Source file or directory path',
                },
                destination: {
                  type: 'string',
                  description: 'Destination file or directory path',
                },
              },
              required: ['source', 'destination'],
            },
          },
          {
            name: 'file_search',
            description: 'Search for files by pattern or content',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'File name pattern (glob) or content to search',
                },
                path: {
                  type: 'string',
                  description: 'Directory to search in',
                  default: '.',
                },
                search_content: {
                  type: 'boolean',
                  description: 'Search file contents instead of names',
                  default: false,
                },
              },
              required: ['pattern'],
            },
          },
          {
            name: 'directory_create',
            description: 'Create a new directory',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path where to create the directory',
                },
                recursive: {
                  type: 'boolean',
                  description: 'Create parent directories if they do not exist',
                  default: true,
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'directory_list',
            description: 'List contents of a directory',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the directory to list',
                  default: '.',
                },
                show_hidden: {
                  type: 'boolean',
                  description: 'Show hidden files and directories',
                  default: false,
                },
              },
            },
          },
          // Shell Command Execution
          {
            name: 'os_execute_command',
            description: 'Execute a shell command',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'Shell command to execute',
                },
                cwd: {
                  type: 'string',
                  description: 'Working directory for the command',
                },
                timeout: {
                  type: 'number',
                  description: 'Command timeout in milliseconds (default: 30000)',
                  default: 30000,
                },
              },
              required: ['command'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Enhanced error handling with detailed logging
        this.logger.debug(`Tool called: ${name} with args: ${JSON.stringify(args)}`);

        switch (name) {
          // Python Tools
          case 'python_execute':
            return await this.executePython(args);
          case 'python_install_package':
            return await this.installPackages(args);
          case 'python_list_packages':
            return await this.listPackages();
          case 'python_reset_environment':
            return await this.resetEnvironment();
          // File and Directory Operations
          case 'file_create':
            return await this.createFile(args);
          case 'file_read':
            return await this.readFile(args);
          case 'file_move':
            return await this.moveFile(args);
          case 'file_copy':
            return await this.copyFile(args);
          case 'file_search':
            return await this.searchFiles(args);
          case 'file_delete':
            return await this.deleteFile(args);
          case 'directory_create':
            return await this.createDirectory(args);
          case 'directory_list':
            return await this.listDirectory(args);
          // Shell Command Execution
          case 'os_execute_command':
            return await this.executeCommand(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.logger.error(`Tool execution failed for ${name}`, error);
        
        // Enhanced error response with more context
        const errorId = randomBytes(8).toString('hex');
        const errorMessage = `Error [${errorId}]: ${error.message}`;
        
        return {
          content: [
            {
              type: 'text',
              text: errorMessage,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Python Tools Implementation
  async ensureVirtualEnvironment() {
    const venvDir = this.venvDir;
    
    if (!existsSync(venvDir)) {
      try {
        this.logger.debug(`Creating virtual environment at: ${venvDir}`);
        
        // Check Python availability and version
        let pythonCmd, pythonVersion;
        try {
          const result = await execAsync('python3 --version');
          pythonCmd = 'python3';
          pythonVersion = result.stdout.trim();
          this.logger.debug(`Found Python: ${pythonVersion}`);
        } catch {
          try {
            const result = await execAsync('python --version');
            pythonCmd = 'python';
            pythonVersion = result.stdout.trim();
            this.logger.debug(`Found Python: ${pythonVersion}`);
          } catch {
            throw new Error('Neither python3 nor python found in PATH. Please install Python 3.7+ and ensure it is in your PATH.');
          }
        }
        
        // Verify Python version compatibility
        const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1]);
          const minor = parseInt(versionMatch[2]);
          if (major < 3 || (major === 3 && minor < 7)) {
            this.logger.warn(`Python version ${pythonVersion} detected. Python 3.7+ is recommended.`);
          }
        }
        
        // Create virtual environment with detailed error handling
        const createCommand = `${pythonCmd} -m venv "${venvDir}"`;
        this.logger.debug(`Executing: ${createCommand}`);
        
        const { stdout, stderr } = await execAsync(createCommand);
        if (stderr && stderr.includes('Error')) {
          throw new Error(`Virtual environment creation failed: ${stderr}`);
        }
        
        // Verify virtual environment was created successfully
        const pythonPath = await this.getPythonPath();
        const pipPath = await this.getPipPath();
        
        this.logger.info(`Virtual environment created: ${venvDir}`);
        this.logger.debug(`Python executable: ${pythonPath}`);
        this.logger.debug(`Pip executable: ${pipPath}`);
        
      } catch (error) {
        this.logger.error(`Failed to create virtual environment at ${venvDir}`, error);
        throw new Error(`Failed to create virtual environment: ${error.message}`);
      }
    } else {
      // Verify existing virtual environment is functional
      try {
        const pythonPath = await this.getPythonPath();
        const { stdout } = await execAsync(`"${pythonPath}" --version`);
        this.logger.debug(`Using existing virtual environment: ${venvDir} (${stdout.trim()})`);
      } catch (error) {
        this.logger.warn(`Virtual environment at ${venvDir} appears to be corrupted, recreating...`);
        await fs.rm(venvDir, { recursive: true, force: true });
        return this.ensureVirtualEnvironment();
      }
    }
  }

  async getPythonPath() {
    const venvDir = this.venvDir;
    const isWindows = process.platform === 'win32';
    const pythonPath = isWindows 
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python');
    
    // Verify the python executable exists and is accessible
    if (!existsSync(pythonPath)) {
      throw new Error(`Python executable not found at ${pythonPath}. Virtual environment may not be properly set up.`);
    }
    
    // Check if file is accessible and executable (Unix only)
    if (!isWindows) {
      try {
        // Use fs from the import instead of require
        await fs.access(pythonPath, fsConstants.F_OK | fsConstants.X_OK);
      } catch (error) {
        throw new Error(`Python executable at ${pythonPath} is not accessible or executable: ${error.message}`);
      }
    }
    
    return pythonPath;
  }

  async getPipPath() {
    const venvDir = this.venvDir;
    const isWindows = process.platform === 'win32';
    const pipPath = isWindows 
      ? join(venvDir, 'Scripts', 'pip.exe')
      : join(venvDir, 'bin', 'pip');
    
    // Verify the pip executable exists and is accessible
    if (!existsSync(pipPath)) {
      throw new Error(`Pip executable not found at ${pipPath}. Virtual environment may not be properly set up.`);
    }
    
    // Check if file is accessible and executable (Unix only)
    if (process.platform !== 'win32') {
      try {
        await fs.access(pipPath, fsConstants.F_OK | fsConstants.X_OK);
      } catch (error) {
        throw new Error(`Pip executable at ${pipPath} is not accessible or executable: ${error.message}`);
      }
    }
    
    return pipPath;
  }

  async executePython(args) {
    const { code, setup_venv = false, requirements = [] } = args;

    try {
      // Validate input
      this.validatePythonCode(code);
      if (requirements.length > 0) {
        this.validatePackages(requirements);
      }

      const workDir = this.workDir;
      
      this.logger.debug('Executing Python code');

      if (setup_venv) {
        await this.resetEnvironment();
      }

      await this.ensureVirtualEnvironment();

      if (requirements.length > 0) {
        await this.installPackages({ packages: requirements });
      }

      // Create image capture directory
      const imageDir = join(workDir, 'images');
      if (!existsSync(imageDir)) {
        mkdirSync(imageDir, { recursive: true });
      }

      // Enhanced code with image capture capabilities and resource limits
      const enhancedCode = this.injectImageCapture(code, imageDir);

      // Create a temporary file for reliable execution
      const tempFile = join(workDir, `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`);
      
      try {
        // Write the code to a temporary file to avoid shell escaping issues
        writeFileSync(tempFile, enhancedCode, 'utf8');
        
        const pythonPath = await this.getPythonPath();
        
        // Validate that the temp file was written successfully
        if (!existsSync(tempFile)) {
          throw new Error('Failed to create temporary Python file');
        }
        
        // Enhanced execution with resource limits
        const maxMemoryMB = this.config.get('maxMemoryMB');
        const timeout = this.config.get('maxExecutionTime');
        
        let execCommand = `"${pythonPath}" "${tempFile}"`;
        
        // Platform-specific resource limits
        if (process.platform === 'linux' && maxMemoryMB > 0) {
          // Linux: Use ulimit for memory limiting
          execCommand = `ulimit -v ${maxMemoryMB * 1024} && ${execCommand}`;
        } else if (process.platform === 'win32' && maxMemoryMB > 0) {
          // Windows: Add memory monitoring (basic implementation)
          // Note: Full memory limiting on Windows requires Job Objects, which is complex
          this.logger.warn(`Memory limiting on Windows is not fully supported. Configured limit: ${maxMemoryMB}MB`);
        }
        
        this.logger.debug(`Executing command: ${execCommand}`);
        
        const execOptions = {
          cwd: workDir,
          timeout,
          maxBuffer: this.config.get('maxOutputSize'),
        };
        
        // Windows-specific: Set additional process options for better resource control
        if (process.platform === 'win32') {
          execOptions.windowsHide = true; // Hide console window
          execOptions.shell = true; // Use shell for better compatibility
        }
        
        const { stdout, stderr } = await execAsync(execCommand, execOptions);

        // Check for generated images
        const images = await this.collectImages(imageDir);

        const content = [];

        // Add images to response first
        images.forEach((imageData, index) => {
          content.push({
            type: 'image',
            data: imageData.data, // 只提供base64数据，不要data:前缀
            mimeType: imageData.mimeType,
          });
        });

        // Then add execution result
        let result = '';
        if (stdout) result += `Output:\n${stdout}`;
        if (stderr) result += `${result ? '\n' : ''}Error/Warning:\n${stderr}`;

        content.push({
          type: 'text',
          text: result || 'Code executed successfully with no output',
        });

        this.logger.debug(`Python execution completed successfully`);
        return { content };
        
      } catch (executionError) {
        this.logger.error('Python execution failed', executionError);
        
        // Enhanced error diagnosis
        const errorDetails = {
          message: executionError.message || 'Unknown execution error',
          stderr: executionError.stderr || '',
          stdout: executionError.stdout || '',
          code: executionError.code || 'UNKNOWN',
          signal: executionError.signal || null,
          killed: executionError.killed || false,
          cmd: executionError.cmd || execCommand
        };
        
        // Analyze error type and provide helpful suggestions
        let errorAnalysis = '';
        if (errorDetails.stderr) {
          if (errorDetails.stderr.includes('ModuleNotFoundError')) {
            errorAnalysis = '\n\n💡 Suggestion: Install the missing module using the python_install_package tool.';
          } else if (errorDetails.stderr.includes('SyntaxError')) {
            errorAnalysis = '\n\n💡 Suggestion: Check your Python code syntax.';
          } else if (errorDetails.stderr.includes('MemoryError')) {
            errorAnalysis = '\n\n💡 Suggestion: Try reducing data size or increase memory limits.';
          } else if (errorDetails.stderr.includes('Permission')) {
            errorAnalysis = '\n\n💡 Suggestion: Check file permissions or try running with appropriate privileges.';
          }
        }
        
        if (errorDetails.code === 'ETIMEDOUT') {
          errorAnalysis = `\n\n💡 Suggestion: Code execution timed out after ${timeout}ms. Consider optimizing your code or increasing the timeout.`;
        } else if (errorDetails.killed) {
          errorAnalysis = '\n\n💡 Suggestion: Process was terminated, possibly due to resource limits.';
        }
        
        let fullErrorMessage = `Python execution failed: ${errorDetails.message}`;
        if (errorDetails.stdout) fullErrorMessage += `\n\nStdout:\n${errorDetails.stdout}`;
        if (errorDetails.stderr) fullErrorMessage += `\n\nStderr:\n${errorDetails.stderr}`;
        if (errorAnalysis) fullErrorMessage += errorAnalysis;
        
        // Add debug information for developers
        if (this.config.get('logLevel') === 'debug') {
          fullErrorMessage += `\n\n🔍 Debug Info:\nCommand: ${errorDetails.cmd}\nExit Code: ${errorDetails.code}\nSignal: ${errorDetails.signal}\nKilled: ${errorDetails.killed}`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: fullErrorMessage,
            },
          ],
          isError: true,
        };
      } finally {
        // Enhanced cleanup with better error handling
        const cleanupTasks = [];
        
        // Clean up temp file
        if (existsSync(tempFile)) {
          cleanupTasks.push(
            fs.unlink(tempFile).catch(error => {
              this.logger.warn(`Failed to delete temp file ${tempFile}: ${error.message}`);
            })
          );
        }
        
        // Clean up images directory
        if (existsSync(imageDir)) {
          cleanupTasks.push(
            fs.rm(imageDir, { recursive: true, force: true }).catch(error => {
              this.logger.warn(`Failed to clean up image directory ${imageDir}: ${error.message}`);
            })
          );
        }
        
        // Clean up any orphaned temp files in the work directory
        try {
          const workDirContents = await fs.readdir(workDir);
          const tempFilePattern = /^temp_\d+_\w+\.py$/;
          const oldTempFiles = workDirContents.filter(file => 
            tempFilePattern.test(file) && file !== tempFile.split('/').pop()
          );
          
          for (const oldTempFile of oldTempFiles) {
            const oldTempPath = join(workDir, oldTempFile);
            try {
              const stats = await fs.stat(oldTempPath);
              // Remove temp files older than 1 hour
              if (Date.now() - stats.mtime.getTime() > 60 * 60 * 1000) {
                cleanupTasks.push(
                  fs.unlink(oldTempPath).catch(error => {
                    this.logger.warn(`Failed to clean up old temp file ${oldTempPath}: ${error.message}`);
                  })
                );
              }
            } catch (statError) {
              // If we can't stat the file, try to delete it anyway
              cleanupTasks.push(
                fs.unlink(oldTempPath).catch(error => {
                  this.logger.warn(`Failed to clean up orphaned temp file ${oldTempPath}: ${error.message}`);
                })
              );
            }
          }
        } catch (readdirError) {
          this.logger.warn(`Failed to scan for orphaned temp files: ${readdirError.message}`);
        }
        
        // Execute all cleanup tasks concurrently
        if (cleanupTasks.length > 0) {
          await Promise.allSettled(cleanupTasks);
        }
      }
    } catch (validationError) {
      this.logger.error('Python validation failed', validationError);
      throw validationError;
    }
  }

  injectImageCapture(code, imageDir) {
    // Properly escape path for cross-platform compatibility
    const escapedImageDir = imageDir.replace(/\\/g, '\\\\').replace(/'/g, "\'");
    
    const imageCapture = `
import os
import sys
import io
import base64
from pathlib import Path

# Setup image capture directory with proper path handling
IMAGE_DIR = r"${escapedImageDir}"
try:
    os.makedirs(IMAGE_DIR, exist_ok=True)
except Exception as e:
    print(f"Warning: Could not create image directory: {e}")
    IMAGE_DIR = os.getcwd()  # Fallback to current directory

# Global image counter and saved figures tracking
_image_counter = 0
_saved_figures = set()  # Track saved figure objects to prevent duplicates

# Hook matplotlib if available
try:
    import matplotlib
    import matplotlib.pyplot as plt
    matplotlib.use('Agg')  # Use non-interactive backend
    
    # Override plt.show() to save images
    _original_plt_show = plt.show
    def _capture_plt_show(*args, **kwargs):
        global _image_counter, _saved_figures
        try:
            if plt.get_fignums():  # If there are figures
                for fig_num in plt.get_fignums():
                    fig = plt.figure(fig_num)
                    fig_id = id(fig)  # Use object id to track unique figures
                    
                    # Only save if this figure hasn't been saved before
                    if fig_id not in _saved_figures:
                        filename = os.path.join(IMAGE_DIR, f'plot_{_image_counter}.png')
                        fig.savefig(filename, dpi=150, bbox_inches='tight', 
                                   facecolor='white', edgecolor='none')
                        _saved_figures.add(fig_id)
                        _image_counter += 1
            # Call original show to clear figures
            _original_plt_show(*args, **kwargs)
        except Exception as e:
            print(f"Warning: Failed to capture plot: {e}")
            _original_plt_show(*args, **kwargs)
    
    plt.show = _capture_plt_show
    
    # Also hook savefig to capture manual saves
    _original_savefig = plt.savefig
    def _capture_savefig(fname, *args, **kwargs):
        global _image_counter, _saved_figures
        try:
            # Get current figure to track it
            current_fig = plt.gcf()
            fig_id = id(current_fig)
            
            if not os.path.isabs(fname):
                # If relative path, save to our image directory
                fname = os.path.join(IMAGE_DIR, f'saved_{_image_counter}.png')
                _saved_figures.add(fig_id)  # Mark as saved
                _image_counter += 1
            else:
                # For absolute paths, still mark as saved to avoid duplicates
                _saved_figures.add(fig_id)
                
            return _original_savefig(fname, *args, **kwargs)
        except Exception as e:
            print(f"Warning: Failed to save figure: {e}")
            return _original_savefig(fname, *args, **kwargs)
    
    plt.savefig = _capture_savefig
    
except ImportError:
    pass  # matplotlib not available
except Exception as e:
    print(f"Warning: Failed to setup matplotlib hooks: {e}")

# Hook PIL/Pillow if available
try:
    from PIL import Image
    _original_pil_show = Image.Image.show
    def _capture_pil_show(self, title=None, command=None):
        global _image_counter
        try:
            filename = os.path.join(IMAGE_DIR, f'pil_{_image_counter}.png')
            self.save(filename)
            _image_counter += 1
        except Exception as e:
            print(f"Warning: Failed to capture PIL image: {e}")
    
    Image.Image.show = _capture_pil_show
except ImportError:
    pass  # PIL not available
except Exception as e:
    print(f"Warning: Failed to setup PIL hooks: {e}")

# Your code starts here:
${code}

# Auto-save any remaining matplotlib figures that haven't been saved yet
try:
    import matplotlib.pyplot as plt
    if plt.get_fignums():
        # Check if there are any unsaved figures
        unsaved_figures = False
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            if id(fig) not in _saved_figures:
                unsaved_figures = True
                break
        
        # Only call show if there are unsaved figures
        if unsaved_figures:
            plt.show()  # This will trigger our capture for unsaved figures only
except:
    pass
`;
    
    return imageCapture;
  }

  async collectImages(imageDir) {
    const images = [];
    
    try {
      if (!existsSync(imageDir)) {
        console.log('Image directory does not exist');
        return images;
      }

      const imageFiles = await glob(join(imageDir, '*.{png,jpg,jpeg,gif,svg}').replace(/\\/g, '/'));
      console.log(`Found ${imageFiles.length} image files:`, imageFiles);
      
      if (imageFiles.length === 0) {
        return images;
      }
      
      // Limit to first 3 images to avoid overwhelming responses
      const limitedFiles = imageFiles.slice(0, 3);
      
      for (const imagePath of limitedFiles) {
        try {
          const stats = await fs.stat(imagePath);
          console.log(`Processing image: ${imagePath} (${stats.size} bytes)`);
          
          // Skip very small files (likely incomplete)
          if (stats.size < 100) {
            console.log(`Skipping very small image: ${imagePath} (${stats.size} bytes)`);
            continue;
          }
          
          const imageBuffer = readFileSync(imagePath);
          
          if (!imageBuffer || imageBuffer.length === 0) {
            console.log(`Empty image file: ${imagePath}`);
            continue;
          }
          
          // Convert to base64 with proper validation
          let base64Data;
          try {
            base64Data = imageBuffer.toString('base64');
          } catch (encodeError) {
            console.error(`Base64 encoding failed for ${imagePath}:`, encodeError.message);
            continue;
          }
          
          if (!base64Data || base64Data.length === 0) {
            console.log(`Failed to encode image: ${imagePath}`);
            continue;
          }
          
          // Enhanced base64 validation
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
            console.log(`Invalid base64 format: ${imagePath} - length: ${base64Data.length}`);
            console.log(`First 100 chars: ${base64Data.substring(0, 100)}`);
            continue;
          }
          
          // Determine proper MIME type
          const ext = imagePath.split('.').pop().toLowerCase();
          let mimeType = 'image/png';
          switch (ext) {
            case 'jpg':
            case 'jpeg':
              mimeType = 'image/jpeg';
              break;
            case 'gif':
              mimeType = 'image/gif';
              break;
            case 'svg':
              mimeType = 'image/svg+xml';
              break;
            default:
              mimeType = 'image/png';
          }
          
          // Create clean data URL - don't include data: prefix in the data field
          images.push({
            data: base64Data,
            mimeType: mimeType,
          });
          
          console.log(`Successfully processed image: ${imagePath} - base64 length: ${base64Data.length}`);
          
        } catch (error) {
          console.error(`Failed to process image ${imagePath}:`, error.message);
        }
      }
      
      if (imageFiles.length > 3) {
        console.log(`Note: Showing first 3 of ${imageFiles.length} generated images`);
      }
      
      console.log(`Returning ${images.length} processed images`);
      
    } catch (error) {
      console.error('Failed to collect images:', error.message);
    }
    
    return images;
  }

  async installPackages(args, session = null) {
    const { packages } = args;
    
    // Validate packages
    this.validatePackages(packages);
    
    await this.ensureVirtualEnvironment(session);
    
    const pipPath = await this.getPipPath(session);
    const packageList = packages.join(' ');
    
    try {
      this.logger.debug(`Installing packages: ${packageList}`);
      
      const { stdout, stderr } = await execAsync(`"${pipPath}" install ${packageList}`, {
        cwd: session ? session.dir : this.workDir,
        timeout: this.config.get('maxExecutionTime'),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Packages installed successfully in ${session ? `session ${session.id}` : 'global environment'}:\n${stdout}${stderr ? '\nWarnings:\n' + stderr : ''}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to install packages: ${error.message}`);
    }
  }

  async listPackages(args = {}) {
    await this.ensureVirtualEnvironment();
    
    const pipPath = await this.getPipPath();
    
    try {
      const { stdout } = await execAsync(`"${pipPath}" list`, {
        cwd: this.workDir,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Installed packages:\n${stdout}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list packages: ${error.message}`);
    }
  }

  async resetEnvironment() {
    try {
      const venvDir = this.venvDir;
      
      if (existsSync(venvDir)) {
        await fs.rm(venvDir, { recursive: true, force: true });
        this.logger.debug(`Removed virtual environment: ${venvDir}`);
      }
      
      await this.ensureVirtualEnvironment();
      
      return {
        content: [
          {
            type: 'text',
            text: 'Virtual environment reset successfully',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to reset environment: ${error.message}`);
    }
  }

  // File and Directory Operations Implementation
  async createFile(args) {
    const { path, content = '', encoding = 'utf8' } = args;
    
    try {
      // Handle relative paths relative to workspace directory
      const resolvedPath = path.startsWith('/') ? path : join(this.workDir, path);
      
      // Ensure target directory exists
      const targetDir = dirname(resolvedPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      
      await fs.writeFile(resolvedPath, content, encoding);
      
      return {
        content: [
          {
            type: 'text',
            text: `File created successfully at ${resolvedPath}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create file ${path}: ${error.message}`);
    }
  }

  async readFile(args) {
    const { path, encoding = 'utf8' } = args;
    
    try {
      const resolvedPath = path.startsWith('/') ? path : join(this.workDir, path);
      const content = await fs.readFile(resolvedPath, encoding);
      
      return {
        content: [
          {
            type: 'text',
            text: content,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error.message}`);
    }
  }

  async moveFile(args) {
    const { source, destination } = args;
    
    try {
      const resolvedSource = source.startsWith('/') ? source : join(this.workDir, source);
      const resolvedDestination = destination.startsWith('/') ? destination : join(this.workDir, destination);
      
      if (!existsSync(resolvedSource)) {
        throw new Error(`Source file does not exist: ${resolvedSource}`);
      }
      
      // Ensure destination directory exists
      const destDir = dirname(resolvedDestination);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      
      await fs.rename(resolvedSource, resolvedDestination);
      
      return {
        content: [
          {
            type: 'text',
            text: `File moved from ${resolvedSource} to ${resolvedDestination}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to move file from ${source} to ${destination}: ${error.message}`);
    }
  }

  async deleteFile(args) {
    const { path } = args;
    
    try {
      const resolvedPath = path.startsWith('/') ? path : join(this.workDir, path);
      
      if (!existsSync(resolvedPath)) {
        throw new Error(`File does not exist: ${resolvedPath}`);
      }
      
      await fs.unlink(resolvedPath);
      
      return {
        content: [
          {
            type: 'text',
            text: `File deleted successfully: ${resolvedPath}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to delete file ${path}: ${error.message}`);
    }
  }

  async createDirectory(args) {
    const { path, recursive = true } = args;
    
    try {
      const resolvedPath = path.startsWith('/') ? path : join(this.workDir, path);
      
      if (existsSync(resolvedPath)) {
        return {
          content: [
            {
              type: 'text',
              text: `Directory already exists: ${resolvedPath}`,
            },
          ],
        };
      }
      
      mkdirSync(resolvedPath, { recursive });
      
      return {
        content: [
          {
            type: 'text',
            text: `Directory created successfully: ${resolvedPath}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create directory ${path}: ${error.message}`);
    }
  }

  async listDirectory(args) {
    const { path = '.', show_hidden = false } = args;
    
    try {
      const resolvedPath = path === '.' ? this.workDir : (path.startsWith('/') ? path : join(this.workDir, path));
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      
      let result = `Contents of ${resolvedPath}:\n\n`;
      
      for (const entry of entries) {
        if (!show_hidden && entry.name.startsWith('.')) {
          continue;
        }
        
        const type = entry.isDirectory() ? 'DIR' : 'FILE';
        const stats = await fs.stat(join(resolvedPath, entry.name));
        const size = entry.isFile() ? ` (${this.formatFileSize(stats.size)})` : '';
        const modified = stats.mtime.toISOString().split('T')[0];
        
        result += `${type.padEnd(4)} ${entry.name}${size} - ${modified}\n`;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list directory ${path}: ${error.message}`);
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // New advanced file operations
  async copyFile(args) {
    const { source, destination } = args;
    
    try {
      const resolvedSource = source.startsWith('/') ? source : join(this.workDir, source);
      const resolvedDestination = destination.startsWith('/') ? destination : join(this.workDir, destination);
      
      if (!existsSync(resolvedSource)) {
        throw new Error(`Source does not exist: ${resolvedSource}`);
      }
      
      // Ensure destination directory exists
      const destDir = dirname(resolvedDestination);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      
      // Check if source is a directory
      const stats = await fs.stat(resolvedSource);
      if (stats.isDirectory()) {
        await fs.cp(resolvedSource, resolvedDestination, { recursive: true });
      } else {
        await fs.copyFile(resolvedSource, resolvedDestination);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `${stats.isDirectory() ? 'Directory' : 'File'} copied from ${resolvedSource} to ${resolvedDestination}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to copy from ${source} to ${destination}: ${error.message}`);
    }
  }

  async searchFiles(args) {
    const { pattern, path = '.', search_content = false } = args;
    
    try {
      const resolvedPath = path === '.' ? this.workDir : (path.startsWith('/') ? path : join(this.workDir, path));
      
      if (!existsSync(resolvedPath)) {
        throw new Error(`Search path does not exist: ${resolvedPath}`);
      }
      
      let results = [];
      
      if (search_content) {
        // Search file contents
        const files = await glob(join(resolvedPath, '**/*').replace(/\\/g, '/'), {
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/venv/**', '**/__pycache__/**']
        });
        
        for (const file of files) {
          try {
            const content = await fs.readFile(file, 'utf8');
            if (content.includes(pattern)) {
              const lines = content.split('\n');
              const matches = [];
              lines.forEach((line, index) => {
                if (line.includes(pattern)) {
                  matches.push(`Line ${index + 1}: ${line.trim()}`);
                }
              });
              results.push(`${file}:\n${matches.slice(0, 5).join('\n')}${matches.length > 5 ? '\n...' : ''}`);
            }
          } catch (error) {
            // Skip files that can't be read as text
            continue;
          }
        }
      } else {
        // Search file names
        const searchPattern = pattern.includes('*') ? pattern : `*${pattern}*`;
        results = await glob(join(resolvedPath, '**', searchPattern).replace(/\\/g, '/'), {
          ignore: ['**/node_modules/**', '**/.git/**', '**/venv/**', '**/__pycache__/**']
        });
      }
      
      const resultText = results.length > 0 
        ? `Found ${results.length} ${search_content ? 'files with content matches' : 'matching files'}:\n\n${results.slice(0, 20).join('\n')}${results.length > 20 ? '\n\n... and more' : ''}`
        : `No ${search_content ? 'content matches' : 'matching files'} found for pattern: ${pattern}`;
      
      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }


  // Shell Command Execution Implementation
  async executeCommand(args) {
    const { command, cwd = '.', timeout = 30000 } = args;
    
    try {
      const resolvedCwd = cwd === '.' ? this.workDir : (cwd.startsWith('/') ? cwd : join(this.workDir, cwd));
      const { stdout, stderr } = await execAsync(command, {
        cwd: resolvedCwd,
        timeout,
      });

      let result = '';
      if (stdout) result += `Output:\n${stdout}`;
      if (stderr) result += `${result ? '\n' : ''}Error/Warning:\n${stderr}`;

      return {
        content: [
          {
            type: 'text',
            text: result || 'Command executed successfully with no output',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to execute command '${command}': ${error.message}`);
    }
  }


  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('MCP Python Server running on stdio (simplified mode)');
    
    // Handle graceful shutdown
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      process.exit(0);
    };
    
    // Register shutdown handlers
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

const server = new MCPServer();
server.run().catch(console.error);