"""
test_shadowing_at_10_12.py
20260812 新增

一次性联调脚本：起 isac_server，第 10 秒推 shadowing，第 12 秒推回 normal，然后保持进程存活
（WebSocket 连接还在，方便你在浏览器里继续看效果）。

跟 isac_server.py 里 __main__ 的 5 秒轮流切换的 demo 模式是两回事，
不改那边的代码，单独留一个脚本方便你以后随时改测试时间点。

用法：
    python test_shadowing_at_10_12.py
"""

import time

from isac_server import start_server_in_background, push_result, has_clients

start_server_in_background(port=8765)
print("isac_server 已启动，等网页连上再开始计时（打开 http://localhost:8080/ 就行）...")

while not has_clients():
    time.sleep(0.1)

print("网页已连上。t=10s -> shadowing, t=12s -> normal。Ctrl+C 退出。")

start = time.time()
sent_shadow = False
sent_normal = False

while True:
    elapsed = time.time() - start

    if not sent_shadow and elapsed >= 10:
        push_result("shadowing")
        sent_shadow = True
        print(f"[{elapsed:.1f}s] -> shadowing")

    if not sent_normal and elapsed >= 12:
        push_result("normal")
        sent_normal = True
        print(f"[{elapsed:.1f}s] -> normal")

    time.sleep(0.05)
