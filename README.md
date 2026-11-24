# MES 运营看板 · 本地演示版

基于 192.168.2.149 生产/测试环境真实 API 快照构建的离线演示系统。
**用途**：对外演示（数据已遮罩）、本地开发调试、架构参考。

> ⚠️ **本仓库数据已脱敏**：事业部名已替换为「全厂 / A~D 事业部」，不含任何生产敏感信息。

---

## 快速开始

```bash
# 一键启动
./start.sh start

# 查看状态
./start.sh status

# 停止
./start.sh stop

# 开机自启（cron @reboot）
./start.sh install

# 重启
./start.sh restart
```

服务默认端口 **8123**，健康检查 `http://localhost:8123/health`。

## 页面一览

| 地址 | 页面 | 来源服务 | 说明 |
|---|---|---|---|
| `/` `/live` | 运营看板（主） | 18123 | 6 大核心指标 + 趋势 + 维度分解 |
| `/admin` | 管理台 | 18123 | API Key / MES 凭据 / 系统日志 |
| `/snapshot` | 快照导出预览 | 18123 | 看板快照静态化预览页 |
| `/report` | 月度运营报告 | 18123 | 11月完整报告（1.3MB 纯静态） |
| `/monthly` | 月度复盘 SPA | 8124 | 复盘系统入口 |
| `/review` | 复盘评审 SPA | 8124 | 评审系统入口 |
| `/openapi.json` | OpenAPI 规范 | 18123 | 67 条 API 定义 |
| `/openapi_8124.json` | OpenAPI 规范 | 8124 | 21 条 API 定义 |

## 项目结构

```
mes_dashboard_8123_local/
├── mock_server.py          # FastAPI 后端：86 个 API 端点 + 7 个页面路由
├── start.sh                # 一键脚本（start/stop/restart/status/install/uninstall）
├── README.md               # 本文件
├── ARCHITECTURE.md         # 系统架构与模块设计
├── DEPLOY.md               # 生产环境部署手册
├── data/                   # 96 个 API 响应 JSON 快照（2026-11-24 抓取）
│   ├── kpi_*.json          # KPI 概览（5 个事业部 × 1 个全厂合计）
│   ├── series_*.json       # 趋势曲线（5 事业部 × 6 指标 × 粒度）
│   ├── breakdown_*.json    # 维度分解（事业部 → 指标 → 设备/班次）
│   ├── metric_detail_*.json# 指标分解明细
│   ├── admin_*.json        # admin API 快照（sysinfo/keys/creds/logs）
│   ├── m8124_*.json        # 8124 月度复盘 API 快照
│   └── *_all.json          # calibers / updates 全量
└── static/                 # 11 个前端静态文件
    ├── index.html          # 主看板（338KB，单页应用）
    ├── admin.html          # 管理台（111KB，单页应用）
    ├── snapshot.html       # 快照页（7MB）
    ├── report.html         # 月度报告（1.3MB，纯静态）
    ├── monthly.html        # 复盘 SPA 入口
    ├── review.html         # 评审 SPA 入口
    ├── echarts.min.js      # 图表库（1MB）
    ├── export_lite.js      # Excel 导出
    ├── help.html           # 操作指南
    ├── openapi.json        # 18123 OpenAPI（67 条）
    └── openapi_8124.json   # 8124 OpenAPI（21 条）
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 后端 | Python + FastAPI + Uvicorn | Python 3.9+ |
| 前端 | 原生 HTML + Vue 2 + ECharts 5 | 打包后单页 |
| 数据库 | **无**（演示版全 JSON 快照） | — |
| 鉴权 | OA SSO（演示版返回模拟 admin） | — |
| 部署 | cron @reboot + macOS | 生产：Windows + NSSM |

## OpenAPI 端点统计

| 来源 | 端点 | 覆盖 |
|---|---|---|
| 18123 看板主服务 | 67 | admin / etl / feedback / calibers / report / kpi / series / breakdown ... |
| 8124 月度复盘 | 21 | monthly/list/detail/actual/case_* / config / me |
| **合并** | **86** | 验收通过 79 / 0 失败 / 7 跳过（页面路由） |

## 事业部遮罩映射

演示数据已替换所有企业专有名称：

| 原名 | 演示名 | Key |
|---|---|---|
| 集团 | **全厂** | `plant` |
| 美发器 | **A事业部** | `div_a` |
| 熨烫 | **B事业部** | `div_b` |
| 个护 | **C事业部** | `div_c` |
| 智能科技 | **D事业部** | `div_d` |

前端 `division=group` 等旧 Key 会自动映射到新 Key，前端代码无需改动。

## 快照来源

| 抓取日期 | 来源 | 说明 |
|---|---|---|
| 2026-11-24 | `192.168.2.149:18123`（测试） | 主看板 + admin + report |
| 2026-11-24 | `192.168.2.149:8124`（月度） | monthly + review 入口 |
| 2026-11-24 | `192.168.2.149:8123`（生产） | openapi.json 规范 |

快照覆盖时间范围：2026-04 ~ 2026-11，每日、每周、每月三种粒度。

## 依赖安装

```bash
pip install fastapi uvicorn
```

## 为什么叫"演示版"

- **无真实数据库连接**：生产版从 T100 (Oracle) + MES 实时取数，演示版返回快照
- **OA SSO 模拟**：`/sso/me` 返回硬编码 admin，不验证真实 OA 会话
- **导出功能空壳**：`/api/export`、`/api/feedback/upload` 等 POST 操作返回 ok 但不落盘
- **ETL 不触发**：`/api/etl/run` 返回 ok 但不调度任何脚本

## 生产版架构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。生产部署见 [DEPLOY.md](DEPLOY.md)。
