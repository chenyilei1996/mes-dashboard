# MES 运营看板 · 系统架构

> 内部参考文档，描述生产版完整架构。演示版为简化版，所有数据库/SSO/ETL 节点均用本地快照替代。

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  用户浏览器                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ 主看板   │ │ 管理台   │ │ 月度报告 │ │ 月度复盘 (8124)  │   │
│  │ /        │ │ /admin   │ │ /report  │ │ /monthly /review │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘   │
└───────┼──────────────┼──────────────┼──────────────┼────────────┘
        │ HTTPS (OA SSO 注入 Cookie)   │ HTTPS        │
┌───────▼──────────────▼──────────────▼──────────────▼────────────┐
│  Nginx (反向代理)  ·  Windows Server 2019                        │
│  149 服务器 · 端口 80 / 443                                      │
│                                                                  │
│  /  → 127.0.0.1:8123  (主看板服务)                                │
│  /admin → 127.0.0.1:8123                                        │
│  /report → 127.0.0.1:8123                                        │
│  /monthly → 127.0.0.1:8124  (月度复盘服务)                        │
│  /review → 127.0.0.1:8124                                        │
└───────┬──────────────────┬──────────────────────────────────────┘
        │                    │
┌───────▼──────────┐ ┌──────▼──────────────┐
│ 主看板 8123       │ │ 月度复盘 8124        │
│ FastAPI + Python │ │ FastAPI + Python     │
│                  │ │                       │
│ 模块:            │ │ 模块:                 │
│ ├─ SSO 鉴权      │ │ ├─ OA SSO             │
│ ├─ KPI 聚合      │ │ ├─ 月度数据汇总       │
│ ├─ 趋势/分解     │ │ ├─ 复盘案例 CRUD      │
│ ├─ Admin 管理    │ │ ├─ 评审流程           │
│ ├─ Caliber 管理  │ │ └─ 报告导出           │
│ ├─ Feedback      │ │                       │
│ ├─ ETL 调度      │ │                       │
│ └─ Report 生成   │ │                       │
└───────┬──────────┘ └──────┬───────────────┘
        │                    │
        │  cx_Oracle          │  cx_Oracle
┌───────▼────────────────────▼────────────────────────────────────┐
│  T100 数据库  (鼎捷 ERP / Oracle 19c)                            │
│  192.168.2.238:1521 · 服务名 topprd                              │
│  账号 dsdata                                                     │
│                                                                  │
│  取数来源:                                                        │
│  ├─ MES 完工入库 / 工单 / 设备                                   │
│  ├─ T100 采购单 / 销售单 / 库存                                  │
│  └─ 自定义 ETL 中间表 (mes_kpi_daily 等)                        │
└─────────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────────┐
│ OA SSO 中心 · Cookie 注入                                         │
│ http://192.168.2.149/a/login → session → /sso/me 返回用户信息    │
└──────────────────────────────────────────────────────────────────┘
```

## 2. 服务划分

### 2.1 主看板服务 (8123)

| 端点 | 模块 | 数据源 | 频率 |
|---|---|---|---|
| `/api/kpi` | KPI 卡片（6 个核心指标） | `mes_kpi_daily` 汇总表 | 每次请求实时算 |
| `/api/series` | 趋势曲线 | `mes_kpi_trend` 明细表 | 按粒度（day/week/month）聚合 |
| `/api/breakdown` | 维度分解 | 工单 + 设备表 | 按设备/班次/事业部分组 |
| `/api/metric_detail` | 指标分解明细 | 工单明细表 | Top-N 排名 |
| `/api/kpi_matrix` | 集团 × 事业部矩阵 | 同 `/api/kpi` 但返回多维 | 每次请求实时算 |
| `/api/admin/*` | 后台管理 | SQLite 本地 | 存 API Key / 凭据 |
| `/api/calibers` | 口径配置 | JSON 文件 | 热加载 |
| `/api/updates` | 更新日志 | SQLite | 前端渲染版本号 |
| `/api/etl/*` | ETL 调度 | subprocess 调 Python 脚本 | 手动触发 |
| `/api/report/*` | 月度报告 | 数据库 + 模板 | 每月生成一次 |

### 2.2 月度复盘服务 (8124)

| 端点 | 模块 | 说明 |
|---|---|---|
| `/api/monthly/list` | 月度数据列表 | 按事业部/月份聚合 |
| `/api/monthly/detail` | 指标明细 | 带实际 vs 目标对比 |
| `/api/monthly/actual` | 实际值抓取 | 从 T100 取当月数据 |
| `/api/monthly/case_*` | 复盘案例 CRUD | 支持案例库管理 |
| `/api/monthly/submit` | 提交评审 | 状态机：draft → submitted → reviewed |

## 3. 数据流

```
[浏览器]  fetch('/api/kpi?division=plant&start=2026-04-01&end=2026-11-23')
    │
    ▼
[FastAPI 路由]  /api/kpi → get_kpi(request)
    │
    ▼
[etl_mes.py]  calc_kpi(division, range)
    │
    ├── SELECT * FROM mes_kpi_daily
    │   WHERE division = ? AND date BETWEEN ? AND ?
    │
    ├── 汇总 fpy / kitting / oee / patrol / plan / first_article
    │
    └── 计算环比/同比/目标达成率
    │
    ▼
[返回 JSON]  {division, metrics:[{key, value, target, delta}, ...]}
```

## 4. 定时任务

| 任务 | 频率 | 说明 |
|---|---|---|
| KPI 日终计算 | 每日 01:00 | 前一天数据跑 `etl_mes.py --mode=daily` |
| 月度报告生成 | 每月 1 号 02:00 | 上月数据，生成 `report.html` + PDF |
| ETL 补数 | 按需手动 | `/api/etl/rerun?date=2026-11-20` |
| 服务守护 | 系统级 | NSSM 自动拉起，崩溃重启延迟 5s |

## 5. 目录结构（生产版）

```
C:\mes_dashboard\
├── main.py                   # FastAPI 入口（同时跑 8123 + 8124）
├── etl_mes.py                # ETL 脚本（KPI 聚合）
├── etl_monthly.py             # 月度复盘 ETL
├── requirements.txt          # 依赖清单
├── src/
│   ├── auth.py               # OA SSO 集成
│   ├── db.py                 # T100 Oracle 连接池
│   ├── kpi.py                # KPI 计算逻辑
│   ├── breakdown.py          # 维度分解
│   ├── admin.py              # 管理台路由
│   └── report.py             # 月度报告生成
├── static/
│   ├── index.html            # 主看板前端
│   ├── admin.html            # 管理台前端
│   ├── snapshot.html         # 快照导出
│   ├── monthly.html          # 月度复盘前端
│   └── report.html           # 月度报告（生成产物）
├── config/
│   ├── calibers.json         # 指标口径配置
│   └── divisions.json        # 事业部配置
├── data/                     # SQLite 本地数据库（admin / updates）
├── logs/                     # 应用日志
└── startup/                  # NSSM 注册为 Windows 服务的脚本
    ├── install_service.bat
    └── mes_dashboard.xml
```

## 6. 与演示版对比

| 维度 | 生产版 | 演示版（本仓库） |
|---|---|---|
| 数据库 | T100 Oracle 实时查询 | 96 个 JSON 快照（2026-11-24 抓取） |
| 鉴权 | OA SSO 真会话 | 模拟 admin 用户返回 |
| ETL | subprocess 调用真实脚本 | 返回 ok 不落盘 |
| 导出 | 真 Excel / PDF 生成 | 返回空壳 |
| 调度 | 定时 + 手动 | 无 |
| 部署 | Windows + NSSM + Nginx | macOS + cron @reboot + 直跑 |
| 事业部名 | 集团/美发器/熨烫/个护/智能科技 | 全厂/A~D 事业部（已遮罩） |

## 7. 安全考虑

- **凭据**：T100 连接串、OA 密钥不进代码仓库，走 `.env` 或系统服务凭据
- **SQL 注入**：所有 Oracle 查询用 cx_Oracle 参数化绑定 `cursor.execute(sql, {:b1: val1})`
- **XSS**：前端渲染用 Vue 模板语法自动转义
- **CORS**：生产版白名单内 4 个 OA 子域名，演示版放开全 `*`
- **OA SSO**：Cookie 由 OA 服务器下发，看板只验证 session 不自己签发

## 8. 监控（建议补充）

当前无系统级监控，建议后续增加：

| 项 | 方案 |
|---|---|
| 服务存活 | NSSM KeepAlive 已有，再加 `curl /health` 定时告警 |
| ETL 失败 | 写 `etl_mes.log` + 飞书 webhook 告警 |
| 慢查询 | `cx_Oracle` 加执行时间日志，>2s 记告警 |
| 前端错误 | Vue `errorHandler` 收集 → 上报 `/api/feedback` |
