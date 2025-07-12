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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { glob } from 'glob';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

class MCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.workDir = join(__dirname, '..', 'workspace');
    this.venvDir = join(this.workDir, 'venv');
    // Define default working directory for user files
    this.userFilesDir = join(this.workDir, 'user_files');
    
    this.setupHandlers();
    this.setupWorkspace();
  }

  setupWorkspace() {
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
    // Create user files directory
    if (!existsSync(this.userFilesDir)) {
      mkdirSync(this.userFilesDir, { recursive: true });
    }
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Python Tools
          {
            name: 'python_execute',
            description: 'Execute Python code in a virtual environment',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Python code to execute',
                },
                setup_venv: {
                  type: 'boolean',
                  description: 'Whether to setup/recreate virtual environment',
                  default: false,
                },
                requirements: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of pip packages to install',
                  default: [],
                },
              },
              required: ['code'],
            },
          },
          {
            name: 'python_install_package',
            description: 'Install Python packages in the virtual environment',
            inputSchema: {
              type: 'object',
              properties: {
                packages: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of packages to install',
                },
              },
              required: ['packages'],
            },
          },
          {
            name: 'python_list_packages',
            description: 'List installed packages in the virtual environment',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'python_reset_environment',
            description: 'Reset the virtual environment',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          // Basic File Operations
          {
            name: 'os_read_file',
            description: 'Read the contents of a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to read',
                },
                encoding: {
                  type: 'string',
                  description: 'File encoding (default: utf8)',
                  default: 'utf8',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'os_write_file',
            description: 'Write content to a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to write',
                },
                content: {
                  type: 'string',
                  description: 'Content to write to the file',
                },
                encoding: {
                  type: 'string',
                  description: 'File encoding (default: utf8)',
                  default: 'utf8',
                },
              },
              required: ['path', 'content'],
            },
          },
          {
            name: 'os_list_directory',
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
          // Basic File Operations
          case 'os_read_file':
            return await this.readFile(args);
          case 'os_write_file':
            return await this.writeFile(args);
          case 'os_list_directory':
            return await this.listDirectory(args);
          // Shell Command Execution
          case 'os_execute_command':
            return await this.executeCommand(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Python Tools Implementation
  async ensureVirtualEnvironment() {
    if (!existsSync(this.venvDir)) {
      try {
        await execAsync(`python3 -m venv "${this.venvDir}"`);
        console.error('Virtual environment created successfully');
      } catch (error) {
        throw new Error(`Failed to create virtual environment: ${error.message}`);
      }
    }
  }

  getPythonPath() {
    const isWindows = process.platform === 'win32';
    return isWindows 
      ? join(this.venvDir, 'Scripts', 'python.exe')
      : join(this.venvDir, 'bin', 'python');
  }

  getPipPath() {
    const isWindows = process.platform === 'win32';
    return isWindows 
      ? join(this.venvDir, 'Scripts', 'pip.exe')
      : join(this.venvDir, 'bin', 'pip');
  }

  async executePython(args) {
    const { code, setup_venv = false, requirements = [] } = args;

    if (setup_venv) {
      await this.resetEnvironment();
    }

    await this.ensureVirtualEnvironment();

    if (requirements.length > 0) {
      await this.installPackages({ packages: requirements });
    }

    // Create image capture directory
    const imageDir = join(this.workDir, 'images');
    if (!existsSync(imageDir)) {
      mkdirSync(imageDir, { recursive: true });
    }

    // Enhanced code with image capture capabilities
    const enhancedCode = this.injectImageCapture(code, imageDir);
    
    // Create a temporary file for the code
    const tempFile = join(this.workDir, `temp_${uuidv4()}.py`);
    writeFileSync(tempFile, enhancedCode);

    try {
      const pythonPath = this.getPythonPath();
      const { stdout, stderr } = await execAsync(`"${pythonPath}" "${tempFile}"`, {
        cwd: this.workDir,
        timeout: 30000, // 30 second timeout
      });

      // Check for generated images
      const images = await this.collectImages(imageDir);

      let result = '';
      if (stdout) result += `Output:\n${stdout}`;
      if (stderr) result += `${result ? '\n' : ''}Error/Warning:\n${stderr}`;

      const content = [
        {
          type: 'text',
          text: result || 'Code executed successfully with no output',
        },
      ];

      // Add images to response
      images.forEach((imageData, index) => {
        content.push({
          type: 'image',
          data: `data:${imageData.mimeType};base64,${imageData.data}`,
          mimeType: imageData.mimeType,
        });
      });

      return { content };
    } finally {
      // Clean up temp file and images
      try {
        await fs.unlink(tempFile);
        // Clean up image directory
        if (existsSync(imageDir)) {
          await fs.rm(imageDir, { recursive: true, force: true });
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  injectImageCapture(code, imageDir) {
    const imageCapture = `
import os
import sys
import io
import base64
from pathlib import Path

# Setup image capture directory
IMAGE_DIR = r"${imageDir.replace(/\\/g, '\\\\')}"
os.makedirs(IMAGE_DIR, exist_ok=True)

# Global image counter
_image_counter = 0

# Hook matplotlib if available
try:
    import matplotlib
    import matplotlib.pyplot as plt
    matplotlib.use('Agg')  # Use non-interactive backend
    
    # Override plt.show() to save images
    _original_plt_show = plt.show
    def _capture_plt_show(*args, **kwargs):
        global _image_counter
        if plt.get_fignums():  # If there are figures
            for fig_num in plt.get_fignums():
                fig = plt.figure(fig_num)
                filename = os.path.join(IMAGE_DIR, f'plot_{_image_counter}.png')
                fig.savefig(filename, dpi=150, bbox_inches='tight', 
                           facecolor='white', edgecolor='none')
                _image_counter += 1
        # Call original show to clear figures
        _original_plt_show(*args, **kwargs)
    
    plt.show = _capture_plt_show
    
    # Also hook savefig to capture manual saves
    _original_savefig = plt.savefig
    def _capture_savefig(fname, *args, **kwargs):
        global _image_counter
        if not os.path.isabs(fname):
            # If relative path, save to our image directory
            fname = os.path.join(IMAGE_DIR, f'saved_{_image_counter}.png')
            _image_counter += 1
        return _original_savefig(fname, *args, **kwargs)
    
    plt.savefig = _capture_savefig
    
except ImportError:
    pass

# Hook PIL/Pillow if available
try:
    from PIL import Image
    _original_pil_show = Image.Image.show
    def _capture_pil_show(self, title=None, command=None):
        global _image_counter
        filename = os.path.join(IMAGE_DIR, f'pil_{_image_counter}.png')
        self.save(filename)
        _image_counter += 1
    
    Image.Image.show = _capture_pil_show
except ImportError:
    pass

# Your code starts here:
${code}

# Auto-save any remaining matplotlib figures
try:
    import matplotlib.pyplot as plt
    if plt.get_fignums():
        plt.show()  # This will trigger our capture
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

  async installPackages(args) {
    const { packages } = args;
    
    await this.ensureVirtualEnvironment();
    
    const pipPath = this.getPipPath();
    const packageList = packages.join(' ');
    
    try {
      const { stdout, stderr } = await execAsync(`"${pipPath}" install ${packageList}`, {
        cwd: this.workDir,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Packages installed successfully:\n${stdout}${stderr ? '\nWarnings:\n' + stderr : ''}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to install packages: ${error.message}`);
    }
  }

  async listPackages() {
    await this.ensureVirtualEnvironment();
    
    const pipPath = this.getPipPath();
    
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
      if (existsSync(this.venvDir)) {
        await fs.rm(this.venvDir, { recursive: true, force: true });
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

  // Basic File Operations Implementation
  async readFile(args) {
    const { path, encoding = 'utf8' } = args;
    
    try {
      const resolvedPath = resolve(path);
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

  async writeFile(args) {
    const { path, content, encoding = 'utf8' } = args;
    
    try {
      let resolvedPath;
      
      // If path is not absolute or trying to write to root, use user files directory
      if (!path.startsWith('/') || path === '/') {
        // Relative path or root path, use user files directory
        const filename = path.startsWith('/') ? path.substring(1) : path;
        resolvedPath = join(this.userFilesDir, filename);
      } else if (path.startsWith('/Users/') || path.startsWith('./') || path.startsWith('../')) {
        // Absolute path in user directory or relative path, use directly
        resolvedPath = resolve(path);
      } else {
        // Other cases, place in user files directory
        const filename = path.split('/').pop(); // Get filename
        resolvedPath = join(this.userFilesDir, filename);
      }
      
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
            text: `File written successfully to ${resolvedPath}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to write file ${path}: ${error.message}`);
    }
  }

  async listDirectory(args) {
    const { path = '.', show_hidden = false } = args;
    
    try {
      const resolvedPath = resolve(path);
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

  // Shell Command Execution Implementation
  async executeCommand(args) {
    const { command, cwd = process.cwd(), timeout = 30000 } = args;
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: resolve(cwd),
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
    console.error('MCP Server running on stdio');
  }
}

const server = new MCPServer();
server.run().catch(console.error);