#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read the two kinds of session files and put everything on ONE time axis.

    snapshot JSON   browser, button "Save Full Snapshot"      (dashSnapshot_*.json, format v2)
    ISAC log npz    Ubuntu, written by isac_bridge.py          (isac_logs/isac_*.npz, format v1)

Both are described in ../snapshots_FORMAT.md. The common time axis is **server time**:
milliseconds since the Unix epoch on the Ubuntu host that runs rt_main.py / isac_bridge.py.

    from session_tools import load_snapshot, load_isac_log
    snap = load_snapshot("dashSnapshot_2026-10-03_16-30-00.json")
    log  = load_isac_log("isac_20261003_163000.npz")          # optional but authoritative

    snap.spec.t_ms, snap.spec.db            # waterfall as stored in the page (float dB, [T, 256])
    snap.iface.t_ms, snap.iface.enabled     # ISAC interface ON/OFF events
    snap.det.t_ms,   snap.det.state         # Doppler-detected / normal flips (rt_main's clock)
    snap.segments.server_ms, .bitrate_bps   # per-segment final bitrate decisions
    ...
    log.wf_t_ms, log.wf_db                  # the same waterfall as saved on Ubuntu (complete)

Everything is plain numpy; no pandas needed.
"""

import base64
import json
from types import SimpleNamespace

import numpy as np


def _arr(records, key, dtype=float, default=np.nan):
    return np.array([r.get(key, default) if r.get(key, default) is not None else default
                     for r in records], dtype=dtype)


class Snapshot(SimpleNamespace):
    pass


def load_snapshot(path: str) -> Snapshot:
    """Browser snapshot (format v2) -> arrays, all times converted to server time (ms)."""
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    meta = raw["meta"]
    if meta.get("formatVersion", 1) < 2:
        raise ValueError("snapshot is format v1 (before 20261003): no spectrogram / clock info")
    clock = meta.get("clock") or {}
    offset = clock.get("offsetMs")
    if offset is None:
        offset = 0.0     # clock never synced (no ISAC messages) -> assume same machine
    tel = raw["telemetry"]

    def srv(wall_ms):    # browser Date.now() -> server time, using the FINAL (best) offset estimate
        return np.asarray(wall_ms, dtype=float) + offset

    # ---- spectrogram (already in server time) ----
    sg = raw.get("spectrogram")
    spec = None
    if sg and sg["nColumns"] > 0:
        q = np.frombuffer(base64.b64decode(sg["dbQ_base64"]), dtype=np.uint8).reshape(sg["nColumns"], sg["nBins"])
        spec = SimpleNamespace(
            t_ms=np.asarray(sg["tServerMs"], float), freqs_hz=np.asarray(sg["freqsHz"], float),
            db=(sg["dbMin"] + q.astype(np.float32) * (sg["dbMax"] - sg["dbMin"]) / 255.0),
            ridge_hz=np.asarray(sg["ridgeHz"], float), raw_hit=np.asarray(sg["rawHit"], np.uint8),
            verdict=np.asarray(sg["verdict"], np.uint8), score=np.asarray(sg["score"], float),
            meta=sg.get("rtMeta", {}))

    # ---- ISAC interface ON/OFF (browser button). t from wallClock + final offset ----
    ie = tel.get("isacInterfaceEvents", [])
    iface = SimpleNamespace(t_ms=srv(_arr(ie, "wallClock")), enabled=_arr(ie, "enabled", bool, False),
                            reason=[r.get("reason") for r in ie])

    # ---- Doppler detection flips (rt_main's clock, already server time) ----
    de = tel.get("dopplerDetections", [])
    det = SimpleNamespace(t_ms=_arr(de, "serverTs"), state=np.array([1 if r.get("state") == "doppler_detected" else 0
                                                                      for r in de], np.uint8),
                          ridge_hz=_arr(de, "ridge"), score=_arr(de, "E"))

    # ---- video play / pause / ended events (use them to exclude paused periods) ----
    vs = tel.get("videoStateEvents", [])
    video_state = SimpleNamespace(t_ms=srv(_arr(vs, "wallClock")), state=[r.get("state") for r in vs],
                                  content_time=_arr(vs, "contentTime"))

    # ---- per-segment decisions ----
    sg_rec = tel.get("segments", [])
    segs = SimpleNamespace(
        server_ms=srv(_arr(sg_rec, "wallClock")), content_start=_arr(sg_rec, "contentStart"),
        content_end=_arr(sg_rec, "contentEnd"), rep_id=_arr(sg_rec, "representationId"),
        bitrate_bps=_arr(sg_rec, "bandwidthNominal"), est_bps=_arr(sg_rec, "estimatedBps"),
        actual_bps=_arr(sg_rec, "actualThroughputBps"), superseded=_arr(sg_rec, "superseded", bool, False),
        isac_mode=[r.get("isacMode") for r in sg_rec],
        interface=_arr(sg_rec, "isacInterface", bool, True),
        doppler_state=[r.get("dopplerState") for r in sg_rec])

    # ---- 10 Hz playback samples ----
    pb = tel.get("playbackSamples", [])
    play = SimpleNamespace(
        server_ms=srv(_arr(pb, "wallClock")), content_time=_arr(pb, "contentTime"),
        buffer_s=_arr(pb, "bufferFillSeconds"), playing_bps=_arr(pb, "playingBandwidth"),
        isac_mode=[r.get("isacMode") for r in pb], interface=_arr(pb, "isacInterface", bool, True),
        recovering=_arr(pb, "isacRecovering", bool, False))

    # ---- buffer by representation (stacked area): x is CONTENT time; map to server time ----
    bb = raw.get("bufferByRep")
    buf = None
    if bb and bb.get("history"):
        t_c = np.array([h["t"] for h in bb["history"]], float)
        by_rank = np.array([h["byRank"] for h in bb["history"]], float)           # [T, n_rep]
        server = (np.interp(t_c, play.content_time, play.server_ms)
                  if len(play.content_time) > 1 else np.full_like(t_c, np.nan))
        buf = SimpleNamespace(content_t=t_c, server_ms=server, by_rank=by_rank,
                              rep_bandwidth_bps=np.array([r["bandwidth"] for r in bb["repLadder"]], float))

    # ---- measured network speed ----
    ns = raw.get("netSpeed")
    net = None
    if ns and ns.get("coarseSamples"):
        cs = ns["coarseSamples"]
        net = SimpleNamespace(server_ms=srv(_arr(cs, "wallClock")), bps=_arr(cs, "bps"),
                              content_start=_arr(cs, "contentStart"))

    return Snapshot(meta=meta, clock_offset_ms=offset, spec=spec, iface=iface, det=det,
                    segments=segs, playback=play, buffer=buf, net=net, video_state=video_state, raw=raw)


def _load_isac_part(path: str) -> SimpleNamespace:
    d = np.load(path, allow_pickle=False)
    db_min, db_max = float(d["wf_db_min"]), float(d["wf_db_max"])
    return SimpleNamespace(
        meta=json.loads(str(d["meta_json"])),
        wf_t_ms=d["wf_t_ms"], wf_freqs_hz=d["wf_freqs_hz"],
        wf_db=(db_min + d["wf_db_q"].astype(np.float32) * (db_max - db_min) / 255.0),
        wf_ridge_hz=d["wf_ridge_hz"], wf_raw_hit=d["wf_raw_hit"],
        wf_verdict=d["wf_verdict"], wf_score=d["wf_score"],
        det_t_ms=d["det_t_ms"], det_state=d["det_state"], det_ridge_hz=d["det_ridge_hz"],
        det_score=d["det_score"],
        iface_t_ms=d["iface_server_recv_ms"],         # authoritative (server clock at arrival)
        iface_client_ms=d["iface_client_ms"], iface_enabled=d["iface_enabled"].astype(bool),
        # format v2: reference-channel dBFS (ch0/ch1) and downlink power, ~50 Hz. Empty arrays for v1 files.
        dbfs_t_ms=d["dbfs_t_ms"] if "dbfs_t_ms" in d.files else np.zeros(0),
        dbfs_mean=d["dbfs_mean"] if "dbfs_mean" in d.files else np.zeros(0, np.float32),
        dbfs_ch0=d["dbfs_ch0"] if "dbfs_ch0" in d.files else np.zeros(0, np.float32),
        dbfs_ch1=d["dbfs_ch1"] if "dbfs_ch1" in d.files else np.zeros(0, np.float32),
        dlpower_t_ms=d["dlpower_t_ms"] if "dlpower_t_ms" in d.files else np.zeros(0),
        dlpower_dbfs=d["dlpower_dbfs"] if "dlpower_dbfs" in d.files else np.zeros(0, np.float32),
        # format v3 (20261009): operator markers (Enter in the bridge terminal). Empty for v1/v2 files.
        marker_t_ms=d["marker_t_ms"] if "marker_t_ms" in d.files else np.zeros(0),
        marker_label=d["marker_label"] if "marker_label" in d.files else np.zeros(0, str),
        video_telemetry=json.loads(str(d["video_telemetry_json"])))


def load_ntg_csv(path: str) -> SimpleNamespace:
    """NTG-2501 CSV written by ntg2501_http_logger.py (isac_bridge.py starts it as isac_logs/ntg_<stamp>.csv).
    Returns arrays keyed by column name, plus t_ms = unix_time*1000 = SERVER time (same clock as the
    ISAC log), and marks = [(t_ms, label)] from the `marker` column. Missing readings are NaN.
    Needs the 20261009 logger (older CSVs have no unix_time: t_ms is then derived from `timestamp`,
    local time, which is fine if the zone is the same)."""
    import csv
    import datetime
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = SimpleNamespace(n=len(rows))
    for k in (rows[0].keys() if rows else []):
        if k in ("timestamp", "up_mod", "down_mod", "device_time", "marker"):
            setattr(out, k, np.array([r[k] for r in rows]))
        else:
            setattr(out, k, np.array([float(r[k]) if r[k] != "" else np.nan for r in rows]))
    if rows and "unix_time" in rows[0]:
        out.t_ms = out.unix_time * 1000.0
    elif rows:
        out.t_ms = np.array([datetime.datetime.fromisoformat(r["timestamp"]).timestamp() * 1000.0
                             for r in rows])
    marks = []
    for r in rows:
        for m in (r.get("marker") or "").split(";"):
            if "@" in m:
                lab, ts = m.rsplit("@", 1)
                marks.append((float(ts) * 1000.0, lab))
    out.marks = marks
    return out


def load_isac_log(*paths) -> SimpleNamespace:
    """Ubuntu session file(s) from isac_bridge.py -> arrays. Times are server time (ms).

    A long session is split into parts (isac_<stamp>_p001.npz, _p002.npz, ...). Pass them all:
        load_isac_log("isac_20261003_163000_p*.npz")           # glob
        load_isac_log("a_p001.npz", "a_p002.npz")               # or a list of files
    Parts are concatenated in name order. The carried-over event that starts every part after the
    first (det_score == -2) is dropped, because the previous part already contains that flip."""
    import glob
    files = []
    for p in paths:
        if isinstance(p, (list, tuple)):
            files += list(p)
        else:
            files += sorted(glob.glob(str(p))) or [str(p)]
    files = sorted(dict.fromkeys(files))
    parts = [_load_isac_part(f) for f in files]
    if len(parts) == 1:
        parts[0].files = files
        return parts[0]
    cat = lambda name: np.concatenate([getattr(q, name) for q in parts])
    det_keep = [q.det_score != -2 if i > 0 else np.ones(len(q.det_score), bool)
                for i, q in enumerate(parts)]
    out = SimpleNamespace(
        meta=dict(parts[0].meta, parts=[q.meta for q in parts]), files=files,
        wf_freqs_hz=parts[0].wf_freqs_hz,
        det_t_ms=np.concatenate([q.det_t_ms[k] for q, k in zip(parts, det_keep)]),
        det_state=np.concatenate([q.det_state[k] for q, k in zip(parts, det_keep)]),
        det_ridge_hz=np.concatenate([q.det_ridge_hz[k] for q, k in zip(parts, det_keep)]),
        det_score=np.concatenate([q.det_score[k] for q, k in zip(parts, det_keep)]),
        video_telemetry=[m for q in parts for m in q.video_telemetry])
    for name in ("wf_t_ms", "wf_db", "wf_ridge_hz", "wf_raw_hit", "wf_verdict", "wf_score",
                 "iface_t_ms", "iface_client_ms", "iface_enabled",
                 "dbfs_t_ms", "dbfs_mean", "dbfs_ch0", "dbfs_ch1", "dlpower_t_ms", "dlpower_dbfs",
                 "marker_t_ms", "marker_label"):
        setattr(out, name, cat(name))
    return out


def step_segments(t_ms, state, t_end_ms, initial=None):
    """Turn flip events into [(t_a, t_b, state)] segments for shading. `initial` is the state
    before the first event (None = leave that part blank)."""
    t_ms = np.asarray(t_ms, float)
    out = []
    cur, t_prev = initial, None
    for t, s in zip(t_ms, state):
        if t_prev is not None and cur is not None:
            out.append((t_prev, t, bool(cur)))
        cur, t_prev = s, t
    if t_prev is not None and cur is not None:
        out.append((t_prev, t_end_ms, bool(cur)))
    return out


def find_stalls(snap, min_s=0.5):
    """Playback stalls = content time not advancing while the video is NOT paused by the user.

    Uses the 10 Hz playback samples and the videoState events (paused ... playing). Returns a list of dicts
    {t_ms (server time), dur_s, content_s, buffer_s, mode (effective), interface (bool), doppler_state}.
    A stall ends with a "playing" videoState event (the page fires it when playback resumes after a buffer underrun).
    Does not include a still-running stall at the very end of the data unless it lasts >= min_s there."""
    pb = snap.playback
    t, c = pb.server_ms, pb.content_time
    paused = np.zeros(len(t), bool)
    cur = None
    for tm, st in zip(snap.video_state.t_ms, snap.video_state.state):
        if st == "paused":
            cur = tm
        elif st in ("playing", "ended") and cur is not None:
            paused |= (t >= cur) & (t < tm)
            cur = None
    if cur is not None:
        paused |= t >= cur
    dt = np.diff(t) / 1000.0
    stalled = (np.diff(c) <= 0.5 * dt) & (~paused[1:])
    raw = snap.raw["telemetry"]["playbackSamples"]
    out, i = [], 0
    while i < len(stalled):
        if stalled[i]:
            j = i
            while j < len(stalled) and stalled[j]:
                j += 1
            d = (t[j] - t[i]) / 1000.0
            if d >= min_s:
                out.append(dict(t_ms=float(t[i]), dur_s=float(d), content_s=float(c[i]), buffer_s=float(pb.buffer_s[i]),
                                mode=pb.isac_mode[i], interface=bool(pb.interface[i]),
                                doppler_state=raw[i].get("dopplerState")))
            i = j
        else:
            i += 1
    return out
