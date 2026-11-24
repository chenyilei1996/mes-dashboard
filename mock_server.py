"""
MES 运营看板 · 本地演示服务
基于 192.168.2.149:18123 测试环境真实数据快照（2026-11-24 抓取）

启动:
    python3 mock_server.py          # 默认 http://localhost:8123
    python3 mock_server.py 8124     # 自定义端口
    ./start.sh restart              # 用一键脚本

或: uvicorn mock_server:app --host 0.0.0.0 --port 8123
"""

import json, os, sys, re
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware

ROOT     = Path(__file__).parent
DATA_DIR = ROOT / "data"
STATIC   = ROOT / "static"

# ── 加载所有 JSON 快照 ────────────────────────────────────────────────────
_snapshots = {}
for p in DATA_DIR.glob("*.json"):
    if p.name.startswith("._"): continue
    try:
        _snapshots[p.stem] = json.load(open(p, encoding="utf-8"))
    except Exception:
        pass

# ── 路由映射: (文件名前缀, API 路径, 需要提取的参数键) ──────────────────
# 规则: 请求路径 + 参数 → 构造快照 stem 名 → 在 _snapshots 里找
ROUTE_MAP = [
    # 看板主 API（参数化）
    ("kpi_",           "/api/kpi",          ["division"]),
    ("series_",        "/api/series",       ["division", "metric"]),
    ("breakdown_",     "/api/breakdown",     ["division", "metric"]),
    ("metric_detail_", "/api/metric_detail",["division", "metric"]),
    # 看板主 API（无参）
    ("kpi_matrix",      "/api/kpi_matrix",   []),
    ("divisions",       "/api/divisions",    []),
    ("metrics",         "/api/metrics",      []),
    ("calibers",        "/api/calibers",     []),
    ("range",           "/api/range",        []),
    ("updates",         "/api/updates",      []),
    ("maint_events",    "/api/maint_events", []),
    ("fqc_stats",       "/api/fqc_stats",    []),
    ("iqc_stats",       "/api/iqc_stats",    []),
    ("ie_efficiency",   "/api/ie_efficiency",[]),
    ("fpy_reason",      "/api/fpy_reason",   []),
    ("fpy_returns",     "/api/fpy_returns",  []),
    ("plan_returns",    "/api/plan_returns", []),
    ("kitting_detail",  "/api/kitting_detail",[]),
    ("report_daily",    "/api/report_daily", []),
    # admin API（已抓快照）
    ("admin_sysinfo",       "/api/admin/sysinfo",       []),
    ("admin_api_keys",      "/api/admin/api_keys",      []),
    ("admin_mes_creds",     "/api/admin/mes_creds",     []),
    ("admin_oplog",         "/api/admin/oplog",         []),
    ("admin_logs",          "/api/admin/logs",          []),
    ("calibers_all",        "/api/calibers/all",        []),
    ("updates_all",         "/api/updates/all",         []),
    ("report_list",         "/api/report/list",         []),
    ("feedback_list",       "/api/feedback/list",       []),
    ("etl_status",          "/api/etl/status",          []),
]

# 事业部 key 兼容层
_DIV_KEY_MAP = {"group":"plant","meifa":"div_a","yuntang":"div_b","gehu":"div_c","znkj":"div_d"}

def _canonical(qs: dict) -> dict:
    """把前端传来的旧事业部 key 映射成演示用的新 key。"""
    r = dict(qs)
    if "division" in r: r["division"] = _DIV_KEY_MAP.get(r["division"], r["division"])
    return r

def _match(api_path: str, qs: dict) -> Optional[dict]:
    """根据 API 路径 + 查询参数，在快照里找匹配数据。"""
    qs = _canonical(qs)
    for prefix, route, pkeys in ROUTE_MAP:
        if api_path != route: continue
        # 构造 stem
        parts = [prefix.rstrip("_")]
        for k in pkeys:
            v = qs.get(k, "")
            if v: parts.append(str(v))
        fname = "_".join(parts)
        if fname in _snapshots: return _snapshots[fname]
        # 兜底：找这个前缀下任意快照返回
        for key in _snapshots:
            if key.startswith(prefix): return _snapshots[key]
    return None

# ── FastAPI ───────────────────────────────────────────────────────────────
# openapi_url=None 禁用内置 /openapi.json，让我们自定义的那个返回真实静态文件
app = FastAPI(title="MES 看板 8123 · 本地演示", version="2.0", openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── 通配 /api/*：先查快照，再查硬编码空返回，最后给合理 mock ──────────────
@app.api_route("/api/{full:path}", methods=["GET","POST","DELETE","PUT"])
async def api_router(full: str, request: Request):
    path = f"/api/{full}"
    qs = dict(request.query_params)

    # 1) 尝试匹配快照
    data = _match(path, qs)
    # 1.1) 兜底：8124 月度复盘的 m8124_ 前缀快照
    if data is None and ("monthly" in path or path in ["/api/config","/api/me"]):
        key = "m8124_" + path.strip("/").replace("/","_").replace("-","_")
        if key in _snapshots: data = _snapshots[key]
        else:
            # 再模糊匹配：m8124_api_me.json → /api/me
            for sk in _snapshots:
                if sk.startswith("m8124_") and sk.endswith("_" + path.strip("/").replace("/","_")):
                    data = _snapshots[sk]; break
            if data is None and path == "/api/me" and "m8124_api_me" in _snapshots:
                data = _snapshots["m8124_api_me"]
    if data is not None:
        return JSONResponse(data)

    # 2) 看是不是 calibers/{key} 这种路径参数形式
    m = re.match(r'^/api/calibers/([^/]+)$', path)
    if m:
        # 返回 calibers_all 里对应 key 的项
        all_cal = _snapshots.get("calibers_all", {})
        if isinstance(all_cal, dict) and m.group(1) in all_cal:
            return JSONResponse(all_cal[m.group(1)])
        return JSONResponse({"ok": False, "error": "caliber not found"})

    # 3) 已知 API → 返回合理空数据（不让前端报错）
    EMPTY_LIST_APIS = {
        "/api/export","/api/oee_anomaly","/api/oee_anomaly_calc",
        "/api/feedback","/api/feedback/list","/api/feedback/upload",
        "/api/feedback/file","/api/feedback/file/",
        "/api/staffing/save","/api/staffing/clear","/api/staffing",
        "/api/etl/rerun","/api/etl/run",
        "/api/report/data","/api/report/delete","/api/report/archive",
        "/api/report/archive/delete","/api/report/archive/import",
        "/api/report/gen","/api/report_attendance",
        "/api/admin/api_keys/delete","/api/admin/api_keys/toggle",
        "/api/admin/mes_creds/delete","/api/admin/mes_creds/test",
        "/api/admin/logs/download","/api/admin/restart",
        "/api/calibers/log","/api/calibers/log/","/api/calibers/revert",
        "/api/updates/","/api/feedback/","/api/report/archive/",
    }
    # 路径参数形式（/api/feedback/{fid}/handle 等）
    if path in EMPTY_LIST_APIS or re.match(r'/api/feedback/\d+/handle', path) \
                                or re.match(r'/api/calibers/.+/revert', path) \
                                or re.match(r'/api/updates/\d+', path):
        return JSONResponse([])

    # 4) POST 类（前端提交操作）返回 ok
    if request.method in ("POST","PUT","DELETE"):
        return JSONResponse({"ok": True})

    print(f"[mock] 未匹配: {request.method} {path} params={qs}")
    return JSONResponse([])

# ── SSO ────────────────────────────────────────────────────────────────────
@app.get("/sso/me")
async def sso_me():
    d = _snapshots.get("sso_me")
    return JSONResponse(d or {"ok":True,"user":"chenyl","role":"admin",
                              "divisions":["plant","div_a","div_b","div_c","div_d"]})

@app.get("/sso/logout")
async def sso_logout():
    return JSONResponse({"ok": True})

# ── 页面路由 ───────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return FileResponse(STATIC / "index.html")

@app.get("/live")
async def live():
    return FileResponse(STATIC / "index.html")

@app.get("/admin")
async def admin():
    f = STATIC / "admin.html"
    return FileResponse(f) if f.exists() else JSONResponse({"ok":True,"msg":"演示版"})

@app.get("/admin/users")
async def admin_users():
    """admin.html 内嵌路由之一，OpenAPI 定义里有。"""
    return JSONResponse([
        {"id":1,"username":"chenyl","role":"admin","division":"全厂","last_login":"2026-11-24"},
        {"id":2,"username":"elen","role":"manager","division":"A事业部","last_login":"2026-11-23"},
    ])

@app.get("/snapshot")
async def snapshot():
    f = STATIC / "snapshot.html"
    return FileResponse(f) if f.exists() else JSONResponse({"ok":True})

@app.get("/report")
async def report_page():
    """11月月度运营报告（纯静态 HTML，已遮罩月立痕迹）。"""
    f = STATIC / "report.html"
    return FileResponse(f) if f.exists() else JSONResponse({"ok":True,"msg":"报告暂缺"})

@app.get("/monthly")
async def monthly():
    """8124 月度复盘 SPA 入口。"""
    f = STATIC / "monthly.html"
    return FileResponse(f) if f.exists() else JSONResponse({"ok":True,"msg":"monthly 暂缺"})

@app.get("/review")
async def review():
    """8124 复盘评审 SPA 入口。"""
    f = STATIC / "review.html"
    return FileResponse(f) if f.exists() else JSONResponse({"ok":True,"msg":"review 暂缺"})

@app.get("/openapi_8124.json")
async def openapi_8124():
    """8124 月度复盘服务的 OpenAPI 规范（21 条）。"""
    f = STATIC / "openapi_8124.json"
    if f.exists(): return FileResponse(f, media_type="application/json")
    return JSONResponse({"error":"not found"})

# ── 静态资源 ──────────────────────────────────────────────────────────────
@app.get("/openapi.json")
async def openapi_spec():
    """优先返回 static/openapi.json（真实 67 条），没有才返回 FastAPI 自动生成的。"""
    real = STATIC / "openapi.json"
    if real.exists() and real.stat().st_size > 5000:  # 真实文件 > 5KB
        return FileResponse(real, media_type="application/json")
    return JSONResponse({"openapi":"3.0","info":{"title":"MES 看板 8123 · Mock","version":"2.0"},
                         "paths": app.openapi().get("paths", {})})

@app.get("/health")
async def health():
    return JSONResponse({"ok":True,"source":"mock snapshot","snapshots":len(_snapshots)})

@app.get("/docs")
async def docs_redirect():
    return JSONResponse({"msg":"本地演示版，接口见 openapi.json"})

@app.get("/static/{filename:path}")
async def static_file(filename: str):
    f = STATIC / filename
    if f.exists():
        return FileResponse(f)
    return Response("not found", status_code=404)

# ── 启动 ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    import uvicorn
    print(f"""
🚀 MES 看板 8123 · 本地演示服务 v2.0
   主看板: http://localhost:{port}/
   管理台: http://localhost:{port}/admin
   快照页: http://localhost:{port}/snapshot
   OpenAPI: http://localhost:{port}/openapi.json
   Swagger UI: http://localhost:{port}/docs
   健康检查: http://localhost:{port}/health
   数据快照: {len(_snapshots)} 个  ({DATA_DIR})
   静态资源: {sum(1 for _ in STATIC.glob("*"))} 个  ({STATIC})
   事业部名遮罩: 全厂 / A事业部 / B事业部 / C事业部 / D事业部
""")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
