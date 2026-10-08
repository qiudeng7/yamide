YAMIDE Android 首个可用预览版：

- 长生命周期 Workspace，由服务端统一管理资源。
- 文件浏览与文本编辑，xterm.js + node-pty 终端，ACP Agent 对话与权限审批。
- 客户端断开不会销毁后台任务，重连可发现资源并回放有限历史。
- 删除 Workspace 会释放挂载资源，保留项目文件。
- 服务端重启恢复 Workspace 元数据，旧运行进程标记为已退出。
- 浏览器资源尚未实现。

安装 `yamide-android-preview.apk`（Android 7.0+），按照仓库 README 在 Linux 电脑启动 Server，然后填写地址和访问令牌。

这是调试签名的 alpha 预览版本，尚未在实际 Android 手机上验证。不同 CI 构建的签名可能变化，更新时可能需要卸载旧版本，重新填写连接设置。Agent 需在服务端安装、登录并配置支持 ACP 的 CLI；普通 Codex CLI 不等同于 ACP Agent。
