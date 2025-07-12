# Python Run MCP 服务器

一个Model Context Protocol (MCP) 服务器，提供Python代码执行和基本文件系统操作功能。

## 功能特性

- **安全的Python代码执行**: 在隔离的虚拟环境中运行代码
- **包管理**: 动态安装和管理pip包
- **虚拟环境管理**: 自动创建、管理和重置虚拟环境
- **图像捕获**: 自动捕获matplotlib和PIL生成的图像
- **文件系统操作**: 读写文件、目录管理
- **Shell命令执行**: 带超时保护的系统命令执行

## 可用工具

### Python工具

#### 1. `python_execute`
在虚拟环境中执行Python代码，自动捕获matplotlib/PIL生成的图像

参数:
- `code` (string, 必需): 要执行的Python代码
- `setup_venv` (boolean, 可选): 是否重新创建虚拟环境
- `requirements` (array, 可选): 要安装的pip包列表

#### 2. `python_install_package`
在虚拟环境中安装Python包

参数:
- `packages` (array, 必需): 要安装的包列表

#### 3. `python_list_packages`
列出虚拟环境中已安装的包

#### 4. `python_reset_environment`
重置虚拟环境

### 文件系统工具

#### 5. `os_read_file`
读取文件内容

参数:
- `path` (string, 必需): 要读取的文件路径
- `encoding` (string, 可选): 文件编码 (默认: utf8)

#### 6. `os_write_file`
写入文件内容，自动使用安全的用户文件目录

参数:
- `path` (string, 必需): 要写入的文件路径
- `content` (string, 必需): 要写入的内容
- `encoding` (string, 可选): 文件编码 (默认: utf8)

#### 7. `os_list_directory`
列出目录内容

参数:
- `path` (string, 可选): 要列出的目录路径 (默认: ".")
- `show_hidden` (boolean, 可选): 显示隐藏文件和目录 (默认: false)

### Shell命令执行

#### 8. `os_execute_command`
执行带超时保护的shell命令

参数:
- `command` (string, 必需): 要执行的shell命令
- `cwd` (string, 可选): 命令的工作目录
- `timeout` (number, 可选): 命令超时时间，毫秒 (默认: 30000)

## 安装和使用

1. 安装依赖:
```bash
npm install
```

2. 启动服务器:
```bash
npm start
```

3. 在Claude Desktop配置中添加此MCP服务器:
```json
{
  "mcpServers": {
    "pythonrun-mcp-server": {
      "command": "node",
      "args": ["/path/to/pythonrun_mcp/src/index.js"]
    }
  }
}
```

## 安全特性

- 代码在隔离的虚拟环境中执行
- 30秒执行超时限制
- 临时文件自动清理
- 工作目录隔离
- 图像文件自动清理

## 系统要求

- Node.js 18+
- Python 3.7+
- 支持 `python3 -m venv` 的系统

## 开发

以文件监听模式启动开发环境:
```bash
npm run dev
```