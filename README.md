# PythonRun MCP 服务器

一个功能强大的 Model Context Protocol (MCP) 服务器，专为 Python 代码执行和文件管理而设计。支持在隔离的虚拟环境中安全执行 Python 代码，并提供完整的文件系统操作功能。

## 🌟 主要特性

### Python 代码执行
- **虚拟环境隔离**：每次执行都在独立的 Python 虚拟环境中运行
- **包管理**：自动安装和管理 Python 包依赖
- **图像捕获**：自动捕获 matplotlib、PIL 等库生成的图像
- **资源限制**：内存和执行时间限制，防止资源滥用
- **错误诊断**：详细的错误信息和建议

### 文件系统操作
- **文件管理**：创建、读取、移动、复制、删除文件
- **目录操作**：创建和列出目录内容
- **文件搜索**：按文件名或内容搜索文件
- **跨平台支持**：Windows、macOS、Linux 全平台兼容

## 🚀 快速开始

### 环境要求
- Node.js 16+ 
- Python 3.7+
- npm 或 yarn

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/ChaNg1o1/pythonrun_mcp.git
cd pythonrun_mcp
```

2. **安装依赖**
```bash
npm install
```

3. **启动服务器**
```bash
npm start
```

或者使用开发模式（支持热重载）：
```bash
npm run dev
```

## 🛠️ 可用工具

### Python 工具

#### `python_execute`
执行 Python 代码，支持自动包安装和图像捕获。

**参数：**
- `code` (必需): 要执行的 Python 代码
- `setup_venv` (可选): 是否重置虚拟环境，默认 false
- `requirements` (可选): 执行前要安装的包列表

**示例：**
```python
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.plot(x, y)
plt.title('正弦函数')
plt.show()
```

#### `python_install_package`
安装 Python 包。

**参数：**
- `packages` (必需): 要安装的包名列表

**示例：**
```json
{
  "packages": ["numpy", "matplotlib", "pandas"]
}
```

#### `python_list_packages`
列出当前已安装的所有 Python 包。

#### `python_reset_environment`
重置 Python 环境，删除所有已安装的包。

### 文件操作工具

#### `file_create`
创建新文件。

**参数：**
- `path` (必需): 文件路径
- `content` (可选): 文件内容，默认为空

#### `file_read`
读取文件内容。

**参数：**
- `path` (必需): 要读取的文件路径

#### `file_move`
移动或重命名文件。

**参数：**
- `source` (必需): 源文件路径
- `destination` (必需): 目标文件路径

#### `file_copy`
复制文件或目录。

**参数：**
- `source` (必需): 源路径
- `destination` (必需): 目标路径

#### `file_delete`
删除文件。

**参数：**
- `path` (必需): 要删除的文件路径

#### `file_search`
搜索文件。

**参数：**
- `pattern` (必需): 搜索模式
- `path` (可选): 搜索目录，默认为当前目录
- `search_content` (可选): 是否搜索文件内容，默认 false

### 目录操作工具

#### `directory_create`
创建目录。

**参数：**
- `path` (必需): 目录路径
- `recursive` (可选): 是否递归创建父目录，默认 true

#### `directory_list`
列出目录内容。

**参数：**
- `path` (可选): 目录路径，默认为当前目录
- `show_hidden` (可选): 是否显示隐藏文件，默认 false

### 系统工具

#### `os_execute_command`
执行系统命令。

**参数：**
- `command` (必需): 要执行的命令
- `cwd` (可选): 工作目录
- `timeout` (可选): 超时时间（毫秒），默认 30000

## ⚙️ 配置选项

可以通过环境变量配置服务器行为：

```bash
# Python 执行超时时间（毫秒）
export MCP_PYTHON_TIMEOUT=30000

# 最大内存限制（MB）
export MCP_MAX_MEMORY_MB=512

# 最大输出大小（字节）
export MCP_MAX_OUTPUT_SIZE=10000000

# 工作目录
export MCP_WORKSPACE_DIR=./workspace

# 日志级别 (error, warn, info, debug)
export MCP_LOG_LEVEL=info
```

## 📁 项目结构

```
pythonrun_mcp/
├── src/
│   └── index.js          # 主服务器文件
├── package.json         # Node.js 依赖配置
├── .gitignore          # Git 忽略文件配置
└── README.md           # 项目说明文档
```

### 日志查看
服务器日志会输出到标准错误流，可以重定向到文件：
```bash
npm start 2> server.log
```

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
