# YAMIDE — Yet Another Mobile IDE

在 Android 手机上使用 Linux 电脑上的文件、终端和 Coding Agent。技术栈：Vue 3 + Capacitor、NestJS、xterm.js + node-pty、ACP TypeScript SDK。

## 安装 APK

从 [GitHub Releases](https://github.com/qiudeng7/yamide/releases) 下载 `yamide-android-preview.apk`，允许安装此来源的应用。最低 Android 7.0，推荐现代 Android System WebView。

当前为 alpha 预览版，使用调试签名；不同 CI 构建可能需要卸载旧版本再安装。没有实际 Android 手机上的验证记录。APK 只包含客户端，需要下方的 Linux 服务端。

## 在电脑启动服务端

适用于 Linux / WSL，Node.js 24、pnpm 11，以及编译 node-pty 所需的 Python 3、make、g++。Ubuntu / Debian 可以先安装 `build-essential python3`。

```bash
git clone https://github.com/qiudeng7/yamide.git
cd yamide
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile --ignore-scripts=false
pnpm --filter @yamide/server build

export YAMIDE_TOKEN="$(openssl rand -hex 32)"
export YAMIDE_ROOT="$HOME"
# 保存该令牌到你自己的密码管理器；App 连接设置需要同一令牌。
pnpm --filter @yamide/server start:prod
```

服务默认监听 `0.0.0.0:3000`。手机输入 `http://电脑的局域网或Tailscale地址:3000` 和访问令牌。HTTP 适用于可信局域网或 VPN；互联网访问应通过 HTTPS 反向代理，并转发 `/api` 和 `/ws`。不要将这个有 Shell 权限的个人服务无认证公开。`YAMIDE_ROOT` 是文件操作的边界，不是 Shell 或 Agent 的操作系统沙箱。

客户端将连接地址和令牌保存在应用本地，连接设置可以修改；退出客户端不会结束后台任务。服务本身需要持续运行；常驻可交给 systemd 或 Docker。

### Docker 常驻

```bash
cp .env.example .env
# 在 .env 中设置随机 YAMIDE_TOKEN 和已有项目目录 YAMIDE_PROJECTS_DIR
# 确保项目目录能被容器里的 UID 1000 读写
docker compose up -d --build
```

App 新建 Workspace 时使用 `/projects` 或它的子目录。容器示例包含 Linux Shell、Node.js 和编译工具；其他开发工具或 ACP Agent 需自行安装到镜像并配置登录信息。

## 配置 ACP Agent

服务端只接受管理员预先配置的命令，不允许客户端传任意启动命令。例如以下配置要求电脑上已经安装并登录了支持 ACP 的 `claude-agent-acp`：

```bash
export YAMIDE_AGENTS='[{"id":"claude","name":"Claude ACP","command":"claude-agent-acp","args":[]}]'
```

在启动服务端前设置。可以配置多个 Agent。普通 Coding CLI 未必支持 ACP，需要对应的 ACP 适配器。当前支持初始化、创建 ACP session、流式消息与工具状态、文件读写、用户权限选择、取消任务；未声明 ACP terminal 能力，不支持交互式登录或扩展功能。Agent 在服务端继承普通环境变量，但不会获得 YAMIDE 访问令牌。

## Workspace 语义

- Workspace 是长生命周期工作现场，绑定一个已有目录。
- 资源管理器、终端、Agent 是 Workspace 管理的实例资源；浏览器留作未来扩展。
- 关闭 App、离开页面或断网，只断开交互连接；服务端的终端与 Agent 任务继续运行。
- 重连重新发现资源，恢复当前状态；每个资源最多保留 512 条、约 1 MiB 内存历史，较旧输出不保证回放。
- 删除 Workspace 结束所挂载的资源并删除记录，不删除工作目录或源文件。
- Workspace 和资源元数据保存在 `~/.yamide/workspaces.json`，可通过 `YAMIDE_STATE_DIR` 修改。服务端重启恢复元数据，旧进程标记为已退出，需要创建新实例；终端滚屏和 Agent 对话不跨服务端重启恢复。
- 单用户个人服务；每个 Workspace 最多 32 个资源。文件编辑限定 UTF-8 文本、1 MiB；阻止路径穿越和符号链接越界。

## 开发与验证

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm --filter @yamide/server test:runtime
```

服务端 `/api` 用 Bearer 令牌认证；WebSocket `/ws` 首条消息认证后挂载资源，令牌不放在 URL。配置 `YAMIDE_ORIGINS`（逗号分隔）可指定额外 Web 来源，默认允许 Vite 和 Capacitor 本地来源。

## 构建 Android

需要 Java 21、Android SDK 36 和 Build Tools 36.0.0。

```bash
pnpm --filter @yamide/client build
pnpm --filter @yamide/client cap:add:android # 仅首次执行
pnpm cap:sync
node scripts/prepare-android.mjs
cd apps/client/android
./gradlew assembleDebug
```

APK 位于 `apps/client/android/app/build/outputs/apk/debug/app-debug.apk`。Android 工程由 Capacitor 生成，不手写原生样板。GitHub Actions 在 main 更新后执行构建、单元与生命周期测试、HTTP/WebSocket 集成检查、lint，再构建 APK 并发布预览 Release。

## 当前限制

没有浏览器资源、跨用户隔离、服务端重启后的进程恢复、永久输出日志、Agent MCP 配置 UI，也没有“终端里让 AI 生成命令”的专用交互。Agent 与 Terminal 已可分别使用。测试包含 ACP 模拟进程，尚未进行真实付费 Agent 账户的端到端验证。
