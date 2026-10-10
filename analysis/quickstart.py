#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print a summary of the dataset and three example analyses. Needs only numpy.

    python3 code/analysis/quickstart.py                     # uses ../../data/* of this package
    python3 quickstart.py SNAPSHOT.json ISAC_LOG.npz        # or give the two files explicitly

What it shows (all times are "server time" = clock of the Ubuntu host that ran the sensing code):
  1. what is in the two files (time span, rates, events)
  2. ISAC interface ON vs OFF: playback quality (stall fraction, mean played bitrate) and
     how much Doppler "exposure" each interval had  -> NOT a controlled experiment, see README
  3. reaction latency: verdict flip -> effective-mode switch in the page
"""
import collections
import glob
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from session_tools import find_stalls, load_isac_log, load_snapshot  # noqa: E402

T = lambda ms: time.strftime("%H:%M:%S", time.localtime(ms / 1000.0))


def find_default():
    root = os.path.dirname(os.path.dirname(HERE))          # package root: code/analysis/ -> ..
    snap = sorted(glob.glob(os.path.join(root, "data", "dashSnapshot_*.json")))
    npz = sorted(glob.glob(os.path.join(root, "data", "isac_*.npz")))
    return (snap[-1] if snap else None), (npz if npz else [])


def runs_of(t_ms, gap_s=2.0):
    """Split a column time axis into continuous runs (one run = one rt_main process lifetime)."""
    cut = np.flatnonzero(np.diff(t_ms) > gap_s * 1000)
    starts = np.r_[0, cut + 1]
    ends = np.r_[cut, len(t_ms) - 1]
    return list(zip(starts, ends))


def main():
    if len(sys.argv) >= 3:
        snap_path, npz_paths = sys.argv[1], sys.argv[2:]
    else:
        snap_path, npz_paths = find_default()
    if not snap_path or not npz_paths:
        print("usage: quickstart.py SNAPSHOT.json ISAC_LOG.npz [more parts]")
        return 1
    snap = load_snapshot(snap_path)
    log = load_isac_log(*npz_paths)

    # ------------------------------------------------------------------ 1. contents
    print("=" * 78)
    print("1. CONTENTS")
    print("=" * 78)
    t = log.wf_t_ms
    print(f"ISAC log  : {os.path.basename(npz_paths[0])}  format v{log.meta.get('format_version')}")
    print(f"  waterfall columns : {len(t)}   {T(t[0])} .. {T(t[-1])}   ({len(t) * 0.04 / 60:.1f} min of data)")
    print("  continuous runs (one per rt_main process; gaps > 2 s split them):")
    for k, (a, b) in enumerate(runs_of(t), 1):
        n, dur = b - a + 1, (t[b] - t[a]) / 1000
        flips = int(np.sum((log.det_t_ms >= t[a]) & (log.det_t_ms <= t[b]) & (log.det_score >= 0)))
        rate = n / dur if dur > 0 else float("nan")
        print(f"    run {k}: {T(t[a])} .. {T(t[b])}  {dur:7.0f} s  {n:6d} columns ({rate:4.1f}/s)  detection flips {flips}")
    print(f"  detection events  : {len(log.det_t_ms)}   (doppler_detected: {int(log.det_state[log.det_score >= 0].sum())})")
    print(f"  interface events  : {[(T(x), 'ON' if e else 'OFF') for x, e in zip(log.iface_t_ms, log.iface_enabled)]}")
    print(f"  dBFS samples      : {len(log.dbfs_t_ms)} (ch0 median {np.median(log.dbfs_ch0):.1f}, ch1 median {np.median(log.dbfs_ch1):.1f} dBFS)")
    print(f"  downlink power    : {len(log.dlpower_t_ms)} samples (median {np.median(log.dlpower_dbfs):.1f} dBFS)")
    print(f"  page telemetry    : {len(log.video_telemetry)} records  {dict(collections.Counter(r['kind'] for r in log.video_telemetry))}")
    sp = snap.spec
    print(f"Snapshot  : {os.path.basename(snap_path)}  clock offset browser->server {snap.clock_offset_ms:+.2f} ms")
    print(f"  waterfall (in page): {len(sp.t_ms)} columns {T(sp.t_ms[0])} .. {T(sp.t_ms[-1])}")
    pb = snap.playback
    print(f"  playback samples  : {len(pb.server_ms)} (10 Hz) {T(pb.server_ms[0])} .. {T(pb.server_ms[-1])}, content time {pb.content_time[0]:.0f} -> {pb.content_time[-1]:.0f} s")
    print(f"  segment decisions : {len(snap.segments.server_ms)} (valid {int((~snap.segments.superseded).sum())}, superseded {int(snap.segments.superseded.sum())})")
    print(f"  video state events: {[(T(x), s) for x, s in zip(snap.video_state.t_ms, snap.video_state.state)]}")

    # ------------------------------------------------------------------ 2. ON vs OFF
    print()
    print("=" * 78)
    print("2. ISAC INTERFACE ON vs OFF  (playback quality per interval; paused video excluded)")
    print("=" * 78)
    t_lo, t_hi = pb.server_ms[0], pb.server_ms[-1]
    # authoritative interface timeline = Ubuntu receive times; the page's init event is in the log too
    ev_t = np.r_[log.iface_t_ms[(log.iface_t_ms >= t_lo - 1000)]]
    ev_s = np.r_[log.iface_enabled[(log.iface_t_ms >= t_lo - 1000)]]
    # paused intervals from video state events
    paused = np.zeros(len(pb.server_ms), bool)
    cur = None
    for tm, st in zip(snap.video_state.t_ms, snap.video_state.state):
        if st == "paused":
            cur = tm
        elif st in ("playing", "ended") and cur is not None:
            paused |= (pb.server_ms >= cur) & (pb.server_ms < tm)
            cur = None
    if cur is not None:
        paused |= pb.server_ms >= cur
    # interface state at each playback sample
    iface = np.ones(len(pb.server_ms), bool)
    for tm, st in zip(ev_t, ev_s):
        iface[pb.server_ms >= tm] = bool(st)
    # exposure: doppler_detected triggers per minute in each state
    trig = log.det_t_ms[(log.det_state == 1) & (log.det_score >= 0)]
    rows = []
    for name, sel in (("ON ", iface & ~paused), ("OFF", ~iface & ~paused)):
        if sel.sum() < 20:
            rows.append((name, 0, None, None, None, None))
            continue
        dur = sel.sum() * 0.1
        buf0 = 100 * np.mean(pb.buffer_s[sel] == 0)
        br = np.nanmean(pb.playing_bps[sel]) / 1e3
        # triggers inside the selected samples' time ranges (approx: count triggers whose time falls on a selected sample)
        idx = np.searchsorted(pb.server_ms, trig)
        idx = idx[(idx > 0) & (idx < len(sel))]
        ntrig = int(sel[idx].sum())
        rows.append((name, dur, buf0, br, ntrig, 60 * ntrig / dur))
    print("  interface   playing time   buffer==0 time   mean played bitrate   Doppler triggers (per min)")
    for name, dur, buf0, br, ntrig, rate in rows:
        if buf0 is None:
            print(f"  {name}         (too little data)")
        else:
            print(f"  {name}        {dur:7.0f} s      {buf0:6.1f} %        {br:8.0f} kbit/s        {ntrig:4d}  ({rate:4.1f}/min)")
    print("  NOTE: motion was NOT scripted; the two intervals saw different amounts of motion (last column).")
    print("        Treat this as a demonstration of the measurement, not as a measured ISAC gain.")

    # ------------------------------------------------------------------ 3. latency
    print()
    print("=" * 78)
    print("3. REACTION LATENCY  verdict flip (rt_main) -> page switches effective mode")
    print("=" * 78)
    tel = snap.raw["telemetry"]
    off = snap.clock_offset_ms
    det_on = np.array([r["serverTs"] for r in tel["dopplerDetections"] if r["state"] == "doppler_detected"])
    mode_on = np.array([r["wallClock"] + off for r in tel["isacEvents"]
                        if r["toMode"] == "doppler_detected" and not r.get("confirmed")])
    lags = []
    for d in det_on:
        nxt = mode_on[mode_on >= d - 50]
        if len(nxt) and nxt[0] - d < 2000:
            lags.append(nxt[0] - d)
    if lags:
        lags = np.array(lags)
        print(f"  detections that switched the page into doppler_detected: {len(lags)} of {len(det_on)}")
        print(f"  latency  median {np.median(lags):.0f} ms   p90 {np.percentile(lags, 90):.0f} ms   max {lags.max():.0f} ms")
        print("  (= rt_main -> UDP -> bridge -> WebSocket -> page; includes the clock-offset estimation error, ~1 ms)")
        print(f"  the other {len(det_on) - len(lags)} detections happened while the interface was OFF (page ignores them)")
    else:
        print("  no matching events")

    # ------------------------------------------------------------------ 4. stalls
    print()
    print("=" * 78)
    print("4. PLAYBACK STALLS  (content time frozen while the video is not paused by the user)")
    print("=" * 78)
    stalls = find_stalls(snap)
    tot = sum(x["dur_s"] for x in stalls)
    play_s = len(pb.server_ms) * 0.1
    print(f"  {len(stalls)} stalls, {tot:.0f} s in total; each one ends with a 'playing' videoState event (buffer underrun recovery)")
    print("   #  start     dur     content  buffer  effective mode     interface  ISAC detection state")
    for k, x in enumerate(stalls, 1):
        print(f"  {k:2d}  {T(x['t_ms'])}  {x['dur_s']:5.1f}s  {x['content_s']:7.1f}s  {x['buffer_s']:4.0f}s  {str(x['mode']):17s}  {'ON ' if x['interface'] else 'OFF'}        {x['doppler_state']}")
    print("  The first stall (content 0 s) is start-up buffering. 'playing' events in section 1 after the first one")
    print("  line up with the end of these stalls. At the end of the snapshot playback is advancing (no permanent freeze).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
