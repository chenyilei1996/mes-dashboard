#!/bin/bash
# MES 看板 8123 本地演示版 —— 一键启动/停止/状态/开机自启管理
# 用法: ./start.sh [start|stop|status|install|uninstall|restart]
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8123
PIDFILE="/tmp/mes_8123.pid"
LOGFILE="/tmp/mes_8123.log"
PLIST_LABEL="com.mes.dashboard.8123"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "✅ 已在运行 (PID $(cat "$PIDFILE"), 端口 $PORT)"
    else
      echo "🚀 启动 mock_server.py 端口 $PORT ..."
      cd "$DIR"
      nohup python3 mock_server.py > "$LOGFILE" 2>&1 &
      echo $! > "$PIDFILE"
      sleep 2
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/health | grep -q 200; then
        echo "✅ 启动成功 —— http://localhost:$PORT/"
      else
        echo "❌ 启动失败，日志:"; tail -20 "$LOGFILE"
        rm -f "$PIDFILE"
      fi
    fi
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null && echo "✅ 已停止 (PID $(cat "$PIDFILE"))" || echo "进程不存在"
      rm -f "$PIDFILE"
    else
      echo "没有 PID 文件，尝试按端口杀..."; lsof -ti :$PORT | xargs kill 2>/dev/null || echo "没进程"
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "✅ 运行中 PID=$(cat "$PIDFILE") 端口=$PORT"
      curl -s http://localhost:$PORT/health
      echo ""
    else
      echo "❌ 未运行"
    fi
    ;;
  restart)
    $0 stop; sleep 1; $0 start
    ;;
  install)
    # 开机自启：cron @reboot（launchd 沙箱不允许 python3 读 exFAT 移动磁盘）
    # 启动器脚本必须放在本地 ~/bin/，由它 cd 到 KINGSTON 跑
    mkdir -p "$HOME/bin"
    cat > "$HOME/bin/mes_8123_launcher.sh" <<LAUNCH
#!/bin/bash
DIR="$DIR"
for i in \$(seq 1 60); do [ -d "\$DIR" ] && break; sleep 2; done
cd "\$DIR" && exec /usr/bin/env python3 mock_server.py
LAUNCH
    chmod +x "$HOME/bin/mes_8123_launcher.sh"

    (crontab -l 2>/dev/null | grep -v "mes_8123"; \
     echo "@reboot /bin/bash $HOME/bin/mes_8123_launcher.sh >> /tmp/mes_8123.log 2>&1") | crontab -
    echo "✅ 已注册开机自启 (cron @reboot)"
    echo "   启动器: $HOME/bin/mes_8123_launcher.sh"
    echo "   注意: KINGSTON 磁盘要插着开机"
  uninstall)
    (crontab -l 2>/dev/null | grep -v "mes_8123") | crontab - 2>/dev/null
    echo "✅ 已注销开机自启"
    rm -f "$HOME/bin/mes_8123_launcher.sh"
    $0 stop
    ;;
  *) echo "用法: $0 [start|stop|status|restart|install|uninstall]"; exit 1;;
esac
