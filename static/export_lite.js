/* ============================================================
 * MesExport —— MES 看板导出模块（零依赖）
 *   · xlsx()  多工作表真 .xlsx（自建 STORE 模式 ZIP，可直接被
 *             Excel / WPS / Numbers 打开，无需任何第三方库、无需联网）
 *   · csv()   单表 CSV（UTF-8 BOM，Excel 双击不乱码）
 *
 * 用法:
 *   MesExport.xlsx([{name:"KPI汇总", rows:[[...],[...]], widths:[14,10]}], "文件名.xlsx")
 *   MesExport.csv ([{name:"明细",  rows:[[...],[...]]}], "文件名.csv")
 *   静态版把本文件内联进 HTML，实时版用 <script src="./export_lite.js">。
 * ============================================================ */
(function (global) {
  "use strict";
  var enc = new TextEncoder();

  /* ---------------- 通用 ---------------- */
  function pad2(n) { return String(n).padStart(2, "0"); }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
           "_" + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  // 清理文件名中的非法字符（Windows/Excel 不允许 \ / : * ? " < > |）
  function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "").slice(0, 120);
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = safeName(filename);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ---------------- CSV ---------------- */
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvBlob(sheets) {
    var rows = (sheets[0] && sheets[0].rows) || [];
    var txt = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    return new Blob(["\ufeff" + txt], { type: "text/csv;charset=utf-8" });
  }

  function csv(sheets, filename) {
    save(csvBlob(sheets), /\.csv$/i.test(filename) ? filename : filename + ".csv");
  }

  /* ---------------- ZIP（STORE，无压缩） ---------------- */
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // 浏览器原生 deflate（Chrome/Edge 103+、Safari 16.4+、Node 18+）；
  // 不支持时返回 null，自动回退 STORE（不压缩），保证任何环境都能导出
  function deflateRaw(bytes) {
    if (typeof CompressionStream === "undefined") return Promise.resolve(null);
    try {
      var cs = new CompressionStream("deflate-raw");
      return new Response(new Blob([bytes]).stream().pipeThrough(cs))
        .arrayBuffer()
        .then(function (ab) {
          var out = new Uint8Array(ab);
          return out.length < bytes.length ? out : null;   // 压不小就别压
        })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  async function zipBlob(files) {
    var d = new Date();
    var tm = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    var dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    var parts = [], central = [], off = 0;

    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      var nb = enc.encode(f.name);
      var raw = (f.data instanceof Uint8Array) ? f.data : enc.encode(f.data);
      var crc = crc32(raw);
      var def = await deflateRaw(raw);
      var method = def ? 8 : 0;
      var data = def || raw;

      var lh = new Uint8Array(30 + nb.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, method, true); lv.setUint16(10, tm, true); lv.setUint16(12, dt, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nb.length, true); lv.setUint16(28, 0, true);
      lh.set(nb, 30);

      var ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
      cv.setUint16(12, tm, true); cv.setUint16(14, dt, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
      cv.setUint32(42, off, true);
      ch.set(nb, 46);

      parts.push(lh, data); central.push(ch);
      off += lh.length + data.length;
    }

    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true); ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eo]), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  /* ---------------- XLSX ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function colName(i) {           // 0 -> A, 25 -> Z, 26 -> AA
    var s = "";
    i = i + 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  // 工作表名：Excel 限制 31 字符，且不得含 [ ] : * ? / \ 与首尾单引号
  function sheetName(n, idx, used) {
    var s = String(n || ("Sheet" + idx)).replace(/[\[\]:*?\/\\]/g, "-").replace(/^'+|'+$/g, "");
    s = (s || ("Sheet" + idx)).slice(0, 31);
    var base = s, k = 2;
    while (used[s]) { s = base.slice(0, 28) + "(" + k + ")"; k++; }
    used[s] = true;
    return s;
  }

  function sheetXml(rows, widths) {
    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<sheetViews><sheetView workbookViewId="0">' +
             '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
             '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/>');
    if (widths && widths.length) {
      out.push("<cols>" + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join("") + "</cols>");
    }
    out.push("<sheetData>");
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri] || [], rn = ri + 1, cells = "";
      for (var ci = 0; ci < row.length; ci++) {
        var v = row[ci];
        if (v === null || v === undefined || v === "") continue;
        var ref = colName(ci) + rn;
        var st = ri === 0 ? ' s="1"' : "";
        if (typeof v === "number" && isFinite(v)) {
          cells += '<c r="' + ref + '"' + st + '><v>' + v + "</v></c>";
        } else {
          cells += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' +
                   esc(v) + "</t></is></c>";
        }
      }
      out.push('<row r="' + rn + '">' + cells + "</row>");
    }
    out.push("</sheetData></worksheet>");
    return out.join("");
  }

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
      '<font><sz val="11"/><color theme="1"/><name val="微软雅黑"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F5FBF"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFB8C2CC"/></left>' +
        '<right style="thin"><color rgb="FFB8C2CC"/></right>' +
        '<top style="thin"><color rgb="FFB8C2CC"/></top>' +
        '<bottom style="thin"><color rgb="FFB8C2CC"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"' +
        ' applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---- 把若干张表组成一个 .xlsx Blob ---- */
  async function xlsxBlob(sheets) {
    var used = {}, names = [], files = [], overrides = [], rels = [];

    sheets.forEach(function (sh, i) {
      var i1 = i + 1;
      names.push(sheetName(sh.name, i1, used));
      files.push({ name: "xl/worksheets/sheet" + i1 + ".xml",
                   data: sheetXml(sh.rows || [], sh.widths) });
      overrides.push('<Override PartName="/xl/worksheets/sheet' + i1 + '.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      rels.push('<Relationship Id="rId' + i1 + '" Type="http://schemas.openxmlformats.org/' +
        'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i1 + '.xml"/>');
    });

    var stRel = "rId" + (sheets.length + 1);
    rels.push('<Relationship Id="' + stRel + '" Type="http://schemas.openxmlformats.org/' +
      'officeDocument/2006/relationships/styles" Target="styles.xml"/>');

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides.join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>";

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";

    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" + names.map(function (n, i) {
        return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + "</sheets></workbook>";

    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.join("") + "</Relationships>";

    var all = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: wbRels },
      { name: "xl/styles.xml", data: STYLES }
    ].concat(files);

    return zipBlob(all);
  }

  function xlsx(sheets, filename) {
    return xlsxBlob(sheets).then(function (blob) {
      save(blob, /\.xlsx$/i.test(filename) ? filename : filename + ".xlsx");
    });
  }

  global.MesExport = {
    xlsx: xlsx, csv: csv,
    xlsxBlob: xlsxBlob, csvBlob: csvBlob,
    stamp: stamp, safeName: safeName, save: save
  };
})(typeof window !== "undefined" ? window : globalThis);

/* Node 环境（校验脚本）导出 */
if (typeof module !== "undefined" && module.exports) { module.exports = globalThis.MesExport; }
