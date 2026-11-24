# MES 运营看板 · 生产环境部署手册

> 服务器：192.168.2.149（Windows Server 2019 · 域环境）
> 维护：chenyl（陈益磊）
> 最后更新：2026-11-24

## 1. 端口与服务

| 端口 | 服务 | 启动方式 | 守护 |
|---|---|---|---|
| 8123 | 主看板（FastAPI + Uvicorn） | `start.bat` 或 NSSM | NSSM `MES_Dashboard` |
| 8124 | 月度复盘（FastAPI + Uvicorn） | `start_monthly.bat` 或 NSSM | NSSM `MES_Monthly` |
| 80/443 | Nginx 反向代理 | Windows 服务 | NSSM `Nginx` |

## 2. 代码位置

```
C:\mes_dashboard\              # 8123 主服务
C:\mes_dashboard_monthly\      # 8124 月度复盘
C:\mes_dashboard_logs\         # 共用日志目录
```

## 3. 首次部署（新机器）

```powershell
# 1) 安装 Python 3.11（Windows x64）
#    https://www.python.org/downloads/
#    安装时勾选 "Add Python to PATH"

# 2) 安装 Git
#    https://git-scm.com/download/win

# 3) Clone 仓库
cd C:\
git clone https://github.com/chenyilei1996/mes-dashboard.git mes_dashboard

# 4) 创建虚拟环境
cd C:\mes_dashboard
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# 5) 配置凭据（不进仓库）
# 创建 C:\mes_dashboard\.env.local
#     DB_HOST=192.168.2.238
#     DB_PORT=1521
#     DB_SERVICE=topprd
#     DB_USER=dsdata
#     DB_PASS=<凭据从密码管理器取>
#     OA_BASE=http://192.168.2.149/a

# 6) 手动启动验证
python main.py
# 浏览器访问 http://localhost:8123/ 验证

# 7) 注册为 NSSM 服务
#    先下载 NSSM 到 C:\tools\nssm.exe
C:\tools\nssm.exe install MES_Dashboard
# Application path: C:\mes_dashboard\venv\Scripts\python.exe
# Startup arguments: main.py --port 8123
# Startup directory: C:\mes_dashboard
# I/O tab → Output: C:\mes_dashboard_logs\mes_8123.log
# I/O tab → Error: C:\mes_dashboard_logs\mes_8123_err.log

# 8) 启动服务
net start MES_Dashboard

# 9) 重复以上步骤部署 8124 到 C:\mes_dashboard_monthly
#    NSSM 服务名: MES_Monthly，端口: 8124
```

## 4. 更新部署

```powershell
# 拉最新
cd C:\mes_dashboard
git pull origin main

# 依赖有变就 install
pip install -r requirements.txt

# 重启服务
net stop MES_Dashboard
net start MES_Dashboard
```

## 5. Nginx 反向代理配置

文件：`C:\nginx\conf\nginx.conf`

```nginx
server {
    listen       80;
    server_name  192.168.2.149;

    # 主看板 + 月度复盘
    location / {
        proxy_pass         http://127.0.0.1:8123;
        proxy_http_version 1.1;
        proxy_set_header   Host               $host;
        proxy_set_header   X-Real-IP          $remote_addr;
        proxy_set_header   X-Forwarded-For    $proxy_add_x_forwarded_for;
        proxy_set_header   Upgrade            $http_upgrade;
        proxy_set_header   Connection         "upgrade";
        proxy_read_timeout 300s;
        client_max_body_size 50m;
    }

    # 月度复盘 SPA（独立服务）
    location /monthly {
        proxy_pass         http://127.0.0.1:8124;
        proxy_http_version 1.1;
        proxy_set_header   Host               $host;
        proxy_set_header   X-Real-IP          $remote_addr;
        proxy_read_timeout 300s;
    }
    location /review {
        proxy_pass         http://127.0.0.1:8124;
        proxy_http_version 1.1;
        proxy_set_header   Host               $host;
        proxy_set_header   X-Real-IP          $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

## 6. NSSM 命令速查

```powershell
# 查看状态
sc query MES_Dashboard
nssm status MES_Dashboard

# 启动/停止
net start MES_Dashboard
net stop  MES_Dashboard

# 重启
nssm restart MES_Dashboard

# 查看日志
type C:\mes_dashboard_logs\mes_8123.log -Wait

# 卸载服务（谨慎）
nssm remove MES_Dashboard confirm
```

## 7. 定时任务

通过 Windows 任务计划程序（或任务调度器）配置：

| 任务 | 计划 | 命令 |
|---|---|---|
| KPI 日终计算 | 每日 01:00 | `C:\mes_dashboard\venv\Scripts\python.exe etl_mes.py --mode=daily` |
| 月度报告生成 | 每月 1 号 02:00 | `C:\mes_dashboard\venv\Scripts\python.exe src\report.py --mode=generate` |

查看历史：`schtasks /query /tn "MES_KPI_Daily" /v`

## 8. 常用运维命令

```powershell
# 测试健康检查
curl http://localhost:8123/health
curl http://localhost:8124/api/health

# 测试 T100 连接
C:\mes_dashboard\venv\Scripts\python.exe -c "import cx_Oracle; c=cx_Oracle.connect('dsdata','<pw>','192.168.2.238:1521/topprd'); print('OK'); c.close()"

# 测试 OA SSO 链路
curl http://192.168.2.149/a/login
# 浏览器拿 Cookie 后：curl -H "Cookie: JSESSIONID=xxx" http://localhost:8123/sso/me

# 查看端口占用
netstat -ano | findstr 8123
# PID 对应进程：tasklist /FI "PID eq 6248"

# 强制杀进程（服务起不来时）
taskkill /PID 6248 /F
net start MES_Dashboard
```

## 9. 备份策略

| 备份 | 频率 | 位置 | 保留 |
|---|---|---|---|
| 代码仓库 | Git 自动 | GitHub | 永久 |
| SQLite 本地库 | 每日 03:00 | `\\backup-server\mes\db\` | 30 天 |
| 月度报告生成产物 | 每月 | `\\backup-server\mes\reports\` | 永久 |
| 日志 | 每小时轮转 | 本地 `logs\` | 7 天 |

备份脚本在 `startup\backup.bat`，由任务计划程序调用。

## 10. 故障排查 Checklist

### 看板打不开

```
□ net start MES_Dashboard          → 服务是否在跑？
□ curl http://localhost:8123/health → 健康检查通吗？
□ netstat -ano | findstr 8123       → 端口被谁占了？
□ 事件查看器 → Windows 日志 → 应用程序 → NSSM → 错误详情
□ C:\mes_dashboard_logs\mes_8123_err.log → python 报什么错？
```

### KPI 全是 0

```
□ /api/kpi 返回里 metrics 值是不是 0？
□ 手动跑 etl_mes.py --mode=daily --date=2026-11-23 看报什么
□ 测试 T100 连接（第 8 节）
□ 查 `SELECT COUNT(*) FROM mes_kpi_daily WHERE date = DATE '2026-11-23'`
```

### OA SSO 登录不过

```
□ 浏览器直接访问 http://192.168.2.149/a/login → 正常吗？
□ 登录后 Cookie 有没有拿到 JSESSIONID？
□ 带 Cookie curl /sso/me → 返回什么？
□ 看板前端 Network 里 /sso/me 调了没有？状态码？
□ nginx.conf 里有没有把 Cookie 透传？
```

### 月度报告生成失败

```
□ src\report.py 手动跑一遍，看 traceback
□ 当月数据有没有（查 mes_kpi_daily 最后一天）
□ 报告模板文件是否存在
□ 磁盘空间
```

## 11. 回滚

```powershell
cd C:\mes_dashboard
git log --oneline -5                # 找回滚点
git checkout HEAD~3                 # 或指定 commit hash
net stop MES_Dashboard
net start MES_Dashboard
# 验证正常后 git checkout 回 main
```

## 12. 安全红线

> 以下操作必须走审批：

- 修改 `.env.local`（凭据）
- 在 `/etc/hosts` 或生产机配置 VPN
- NSSM 服务的 `Application path` 改动
- 数据库直连做 DML（改表/删数据）
- OA SSO 白名单增减
- 任何端口对外开放（白名单内 IP）
