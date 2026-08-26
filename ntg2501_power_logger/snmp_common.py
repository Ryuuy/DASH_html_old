#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。给这个文件夹里其它脚本共用的一点 SNMP 子进程封装。

**故意不用 pysnmp**：pysnmp 的 Python API 这几年经历过几次不兼容重写（老的
etingof/pysnmp 的 hlapi 生成器写法，跟现在 PyPI 上 lextudio 维护的 v7.x 是不同的
调用方式），我这边没有真实设备可以跑起来验证哪套写法在当前版本上真的能用；
这份代码要在没人盯着的实验室 PC 上无人值守跑，用一个我没法验证的 API 风险太大。

改成直接 subprocess 调 Net-SNMP 的命令行工具（snmpget/snmpwalk/snmpbulkwalk）——
这套命令行接口二十多年没变过，网上现存的所有 NTG-2501/SNMP 相关经验也都是基于
这套工具写的，可预测性高得多。代价是 Windows 上每次调用都要开一个新进程，
有几到几十毫秒的固定开销，见 README.md 里"轮询速率的真实上限"那节。

安装：装 Net-SNMP for Windows（net-snmp.org 官方安装包，或者搜
"net-snmp windows binary unofficial" 的社区预编译版），装完确认 `snmpget`/
`snmpwalk`/`snmpbulkwalk` 在 PATH 里，也就是新开一个终端敲 `snmpget --version`
能出版本号。
"""

import shutil
import subprocess
import sys
import time

# 20260826 新增：中文 Windows 默认控制台编码是 GBK（代码页 936），不是 UTF-8——
# 这几个脚本里到处用的 ✅❌⚠️📶 这类 emoji 在 GBK 里没有对应字符，print() 到
# 控制台会直接抛 UnicodeEncodeError 崩掉整个脚本。这在实测（cmd.exe，GBK 控制台）
# 里真的复现了，不是猜的。改成显式把 stdout/stderr 重设成 UTF-8（errors="replace"
# 兜底——就算某个终端环境下重设也不管用，最坏情况是打印出"?"而不是直接崩溃）。
# 只在 import 这个模块时执行一次；这几个脚本互相之间是 import snmp_common 才会
# 走到这里，snmp_diff.py 不 import 这个模块，所以它自己在文件头单独复制了一份
# 同样的三行，见该文件。
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

REQUIRED_TOOLS = ("snmpget", "snmpwalk", "snmpbulkwalk")


def check_tools_available() -> list[str]:
    """返回 PATH 里找不到的工具名列表；全都找到了就返回空列表。"""
    missing = [t for t in REQUIRED_TOOLS if shutil.which(t) is None]
    return missing


def require_tools() -> None:
    """找不到必需工具就打印清楚的安装指引然后退出（不是抛异常——这是给
    脚本 __main__ 入口用的守卫，不是库函数该有的行为，其它模块 import 这个
    文件时不会被这个副作用影响，只有真的调用 require_tools() 才会检查）。
    """
    missing = check_tools_available()
    if not missing:
        return
    print(f"缺少命令行工具：{', '.join(missing)}")
    print()
    print("装 Net-SNMP for Windows：")
    print("  1. 官方安装包：https://www.net-snmp.org/download.html （选 Windows）")
    print("     或者搜 \"net-snmp windows binary unofficial\"，有现成编译好的免安装版")
    print("  2. 装完把 snmpget.exe / snmpwalk.exe / snmpbulkwalk.exe 所在目录加进")
    print("     系统 PATH（安装包一般会自动加，免安装版要手动加）")
    print("  3. 新开一个终端（PATH 改动对已经开着的终端不生效），敲：")
    print("       snmpget --version")
    print("     能打印出版本号就装好了")
    raise SystemExit(1)


def run_snmp_cmd(args: list[str], timeout_sec: float = 3.0):
    """跑一条 snmp 命令行工具，返回 (stdout, stderr, returncode, elapsed_ms)。

    永远不抛异常（除了真正意料之外的情况）——超时/命令不存在/设备不回应
    都用 returncode!=0 或者 stderr 非空来表达，调用方自己决定怎么处理，
    不在这一层就吞掉细节（对应 prompt 里"record or clearly report SNMP
    timeout/errors rather than silently dropping them"）。
    """
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout_sec
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return proc.stdout, proc.stderr, proc.returncode, elapsed_ms
    except subprocess.TimeoutExpired:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return "", f"TIMEOUT after {timeout_sec}s", -1, elapsed_ms
    except FileNotFoundError as e:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return "", f"命令不存在: {e}", -2, elapsed_ms


def snmpget_value(host: str, oid: str, community: str = "public",
                   version: str = "2c", timeout_sec: float = 3.0):
    """取单个 OID 的值，用 `-Oqv`（只打印值本身，不带 OID 名/类型前缀）
    简化解析。返回 (raw_text_or_None, error_str_or_None, elapsed_ms)。

    raw_text 是**原始字符串**，故意不在这里转数字/做单位换算——net-snmp
    对不同 MIB 类型的输出格式不完全一致（INTEGER 直接是数字，Gauge32/
    Counter 可能带单位后缀，STRING 会带双引号），而且设备内部的 dBm 缩放
    约定（-54 还是 -540 还是 540，见 prompt 里的提醒）现在还不知道——
    转换交给调用方（ntg2501_logger.py 的 --scale/--offset），这里只负责
    "尽量原样、尽量诚实地"把设备说的话转成字符串。
    """
    args = ["snmpget", "-v", version, "-c", community, "-Oqv", host, oid]
    out, err, rc, elapsed_ms = run_snmp_cmd(args, timeout_sec)
    if rc != 0:
        return None, (err.strip() or f"snmpget 返回码 {rc}"), elapsed_ms
    text = out.strip()
    if not text:
        return None, "snmpget 返回空输出", elapsed_ms
    return text, None, elapsed_ms


def parse_scaled_float(raw_text: str, scale: float = 1.0, offset: float = 0.0):
    """把 snmpget_value() 拿到的原始字符串按 value*scale + offset 转成 float。

    net-snmp 的 STRING 类型输出会带双引号（比如 `"-54.0"`），这里顺手剥掉。
    转不成数字就返回 None，不抛异常——调用方看到 None 就知道这次采样无效，
    对应 CSV 里的 valid 列。
    """
    text = raw_text.strip().strip('"')
    try:
        return float(text) * scale + offset
    except ValueError:
        return None
