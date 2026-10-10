#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One publication-style figure from a DASH session: Doppler spectrogram + detection, ISAC
interface ON/OFF, bitrate/throughput and buffer, all on the same server-time axis.

    python3 plot_session.py dashSnapshot_2026-10-03_16-30-00.json
    python3 plot_session.py dashSnapshot_*.json --isac-log ../../RealtimeISAC/isac_logs/isac_*.npz \
            --window 5 60 --out fig_session

    --isac-log  optional (one or several parts, e.g. isac_*_p*.npz); if given, the spectrogram and the ISAC-interface events are taken from
                the Ubuntu file (complete, and the interface events carry the server's own receive
                time). Without it everything comes from the browser snapshot.
    --window    seconds (relative to the first spectrogram column) to plot, e.g. 5 60
    --start-time/--end-time   the same thing as local clock times, e.g. --start-time 18:33:08 --end-time 18:40:19
                (the date is taken from the data). Easier than computing seconds.
    --out       output prefix; writes <out>.pdf (vector) and <out>.png (300 dpi)
    --width     figure width in inches (default 7.16 = IEEE double column)

Panels (top to bottom, shared x axis, t = seconds since the first spectrogram column):
  (a) Doppler spectrogram. Dashed RED line = verdict turns "Doppler detected",
      dashed BLACK line = back to normal.
  (b) DC ridge width, threshold (dotted), verdict shading.
  (c) Received power in dBFS (needs --isac-log, format v2): ch0 reference, ch1 sensing, downlink.
  (d) ISAC interface ON (green) / OFF (grey), and the effective playback mode
      (orange = doppler_detected, yellow = recovering, light grey = normal).
  (e) Played bitrate (step) and measured network throughput.
  (f) Buffer occupancy stacked by representation (highest bitrate at the bottom).
"""

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session_tools import find_stalls, load_isac_log, load_snapshot, step_segments  # noqa: E402


def uniform_resample(t_ms, db, gap_factor=2.5):
    """Spectrogram columns -> uniform time grid (nearest column); gaps become NaN, not stretched."""
    dt = float(np.median(np.diff(t_ms)))
    grid = np.arange(t_ms[0], t_ms[-1] + dt / 2, dt)
    idx = np.clip(np.searchsorted(t_ms, grid), 1, len(t_ms) - 1)
    left_closer = (grid - t_ms[idx - 1]) < (t_ms[idx] - grid)
    idx = np.where(left_closer, idx - 1, idx)
    out = db[idx].copy()
    out[np.abs(t_ms[idx] - grid) > gap_factor * dt] = np.nan
    return grid, out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot")
    ap.add_argument("--isac-log", nargs="+", default=None,
                    help="Ubuntu isac_*.npz file(s); a long run is split into _pNNN parts, pass a glob or all of them")
    ap.add_argument("--window", nargs=2, type=float, default=None, metavar=("START_S", "END_S"))
    ap.add_argument("--start-time", default=None, metavar="HH:MM:SS")
    ap.add_argument("--end-time", default=None, metavar="HH:MM:SS")
    ap.add_argument("--out", default=None)
    ap.add_argument("--width", type=float, default=7.16)
    ap.add_argument("--fmax", type=float, default=500.0)
    a = ap.parse_args()

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.patheffects as pe
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    plt.rcParams.update({"font.family": "sans-serif",
                         "font.sans-serif": ["DejaVu Sans", "Arial", "Liberation Sans"],
                         "font.size": 7, "axes.labelsize": 7, "axes.titlesize": 7,
                         "legend.fontsize": 6, "xtick.labelsize": 6.5, "ytick.labelsize": 6.5,
                         "pdf.fonttype": 42, "ps.fonttype": 42, "axes.linewidth": 0.6})

    snap = load_snapshot(a.snapshot)
    log = load_isac_log(*a.isac_log) if a.isac_log else None

    # ---- choose sources ----
    if log is not None:
        wf_t, wf_db, freqs = log.wf_t_ms, log.wf_db, log.wf_freqs_hz
        ridge, verdict = log.wf_ridge_hz, log.wf_verdict
        thr = float(log.meta.get("rt_meta", {}).get("ridge_thresh_hz", 90.0))
        if_t, if_en = log.iface_t_ms, log.iface_enabled
        src = "ISAC log (Ubuntu)"
    elif snap.spec is not None:
        wf_t, wf_db, freqs = snap.spec.t_ms, snap.spec.db, snap.spec.freqs_hz
        ridge, verdict = snap.spec.ridge_hz, snap.spec.verdict
        thr = float(snap.spec.meta.get("ridge_thresh_hz", 90.0))
        if_t, if_en = snap.iface.t_ms, snap.iface.enabled
        src = "browser snapshot"
    else:
        print("no spectrogram data in the snapshot (was isac_bridge.py / rt_main.py --isac running?)")
        return 1
    if len(wf_t) < 3:
        print("too few spectrogram columns")
        return 1

    t0 = wf_t[0]
    S = lambda t_ms: (np.asarray(t_ms, float) - t0) / 1000.0
    x_lo, x_hi = (a.window if a.window else (0.0, S(wf_t[-1])))
    if a.start_time or a.end_time:
        import time as _time
        day = _time.strftime("%Y-%m-%d", _time.localtime(t0 / 1000.0))
        def wall(hms):
            return (_time.mktime(_time.strptime(f"{day} {hms}", "%Y-%m-%d %H:%M:%S")) * 1000.0 - t0) / 1000.0
        if a.start_time:
            x_lo = wall(a.start_time)
        if a.end_time:
            x_hi = wall(a.end_time)
    pw = None
    if log is not None and len(getattr(log, "dbfs_t_ms", [])) > 10:
        pw = log

    fig = plt.figure(figsize=(a.width, a.width * 1.3))
    gs = fig.add_gridspec(7, 2, width_ratios=[60, 1], height_ratios=[3.2, 1.1, 1.2, 0.55, 0.55, 1.5, 1.5],
                          hspace=0.16, wspace=0.02, left=0.09, right=0.93, top=0.98, bottom=0.06)
    ax_s = fig.add_subplot(gs[0, 0])
    ax_r = fig.add_subplot(gs[1, 0], sharex=ax_s)
    ax_p = fig.add_subplot(gs[2, 0], sharex=ax_s)
    ax_i = fig.add_subplot(gs[3, 0], sharex=ax_s)
    ax_m = fig.add_subplot(gs[4, 0], sharex=ax_s)
    ax_b = fig.add_subplot(gs[5, 0], sharex=ax_s)
    ax_u = fig.add_subplot(gs[6, 0], sharex=ax_s)
    cax = fig.add_subplot(gs[0, 1])

    # ---- (a) spectrogram ----
    grid, img = uniform_resample(wf_t, wf_db)
    keep = np.abs(freqs) <= a.fmax
    m = (S(grid) >= x_lo) & (S(grid) <= x_hi)
    vis = img[m][:, keep]
    lo, hi = np.nanpercentile(vis, [5, 99.5]) if np.isfinite(vis).any() else (-80, 0)
    im = ax_s.imshow(img[:, keep].T, origin="lower", aspect="auto", cmap="jet", vmin=lo, vmax=hi,
                     interpolation="nearest",
                     extent=[S(grid[0]), S(grid[-1]), freqs[keep][0], freqs[keep][-1]])
    cb = fig.colorbar(im, cax=cax)
    cb.set_label("Relative power (dB)")
    ax_s.set_ylabel("Doppler frequency (Hz)")
    ax_s.set_facecolor("#101018")
    halo = [pe.withStroke(linewidth=2.4, foreground="white")]
    flips = np.flatnonzero(np.diff(verdict.astype(int)) != 0) + 1
    long_window = (x_hi - x_lo) > 90.0
    if not long_window:
        # short window: red dashed = turns "Doppler detected", black dashed = back to normal
        for k in flips:
            on = verdict[k] == 1
            for ax in (ax_s, ax_r):
                ax.axvline(S(wf_t[k]), color="#e00000" if on else "k", ls=(0, (5, 3)), lw=1.0,
                           path_effects=halo if ax is ax_s else None, zorder=5)
        ax_s.legend([plt.Line2D([], [], color="#e00000", ls=(0, (5, 3)), lw=1.2, path_effects=halo),
                     plt.Line2D([], [], color="k", ls=(0, (5, 3)), lw=1.2, path_effects=halo)],
                    ["Doppler detected", "Back to normal"], loc="upper right", frameon=True,
                    framealpha=0.85, handlelength=2.2)
    else:
        # long window: dashed lines would overprint (hundreds of flips). Draw a red strip along the top
        # edge of the spectrogram wherever the verdict is "Doppler detected" instead.
        fmax_ax = freqs[keep][-1]
        ax_s.fill_between(S(wf_t), fmax_ax - 28, fmax_ax, where=verdict.astype(bool), color="#e00000",
                          step="mid", lw=0, zorder=5)
        ax_s.legend([Patch(fc="#e00000")], ["Verdict: Doppler detected (top strip)"], loc="lower right",
                    frameon=True, framealpha=0.85)
    ax_s.text(0.005, 0.98, "(a)", transform=ax_s.transAxes, va="top", color="w", fontweight="bold")
    plt.setp(ax_s.get_xticklabels(), visible=False)

    # ---- (b) ridge ----
    for ta, tb, on in step_segments(wf_t[np.r_[0, flips]], verdict[np.r_[0, flips]], wf_t[-1]):
        if on:
            ax_r.axvspan(S(ta), S(tb), color="#d62728", alpha=0.18, lw=0)
    ax_r.plot(S(wf_t), ridge, color="#4c3a8f", lw=0.6)
    ax_r.axhline(thr, color="k", ls=":", lw=0.7)
    ax_r.set_ylim(0, 200)
    ax_r.set_ylabel("DC ridge\nwidth (Hz)")
    ax_r.grid(alpha=0.3, lw=0.4)
    ax_r.text(0.005, 0.95, "(b)", transform=ax_r.transAxes, va="top", fontweight="bold")
    ax_r.legend([plt.Line2D([], [], color="k", ls=":", lw=0.8), Patch(fc="#d62728", alpha=0.3)],
                [f"Threshold ({thr:g} Hz)", "Doppler detected"], loc="upper right", ncol=2,
                frameon=True, framealpha=0.85)
    plt.setp(ax_r.get_xticklabels(), visible=False)

    # ---- (c) received power ----
    if pw is not None:
        def smooth(x, n=10):
            k = np.ones(n) / n
            return np.convolve(x, k, mode="same")
        ax_p.plot(S(pw.dbfs_t_ms), smooth(pw.dbfs_ch0), color="#1f77b4", lw=0.5, label="ch0 (reference)")
        ax_p.plot(S(pw.dbfs_t_ms), smooth(pw.dbfs_ch1), color="#d62728", lw=0.5, label="ch1 (sensing)")
        if len(pw.dlpower_t_ms):
            ax_p.plot(S(pw.dlpower_t_ms), smooth(pw.dlpower_dbfs), color="#2ca02c", lw=0.5, label="downlink")
        ax_p.legend(loc="upper right", ncol=3, frameon=True, framealpha=0.85)
        ax_p.grid(alpha=0.3, lw=0.4)
    else:
        ax_p.text(0.5, 0.5, "power panel needs --isac-log (format v2)", transform=ax_p.transAxes,
                  ha="center", va="center", color="#888")
    ax_p.set_ylabel("Power\n(dBFS)")
    ax_p.text(0.005, 0.95, "(c)", transform=ax_p.transAxes, va="top", fontweight="bold")
    plt.setp(ax_p.get_xticklabels(), visible=False)

    # ---- (d) ISAC interface + effective mode ----
    t_end = wf_t[-1]
    # before the first recorded event the interface is ON (the page starts with it ON)
    if len(if_t):
        for ta, tb, on in step_segments(np.r_[wf_t[0], if_t], np.r_[True, if_en], t_end):
            ax_i.axvspan(S(ta), S(tb), color="#28a745" if on else "#9a9a9a", lw=0, alpha=0.9)
    else:
        ax_i.axvspan(S(wf_t[0]), S(t_end), color="#28a745", lw=0, alpha=0.9)
    ax_i.set_yticks([])
    ax_i.set_ylabel("ISAC\ninterface", rotation=0, ha="right", va="center", labelpad=2)
    ax_i.legend([Patch(fc="#28a745"), Patch(fc="#9a9a9a")], ["ON", "OFF"], loc="center left",
                bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=5.5, handlelength=1)
    plt.setp(ax_i.get_xticklabels(), visible=False)
    ax_i.text(0.005, 0.5, "(d)", transform=ax_i.transAxes, va="center", fontweight="bold")

    pb = snap.playback
    cmap = {"normal": "#e6e6e6", "doppler_detected": "#ff8c00", "shadowing": "#ff8c00"}
    if len(pb.server_ms):
        edges = np.r_[pb.server_ms, pb.server_ms[-1] + 100]
        for i in range(len(pb.server_ms)):
            c = "#ffd700" if pb.recovering[i] else cmap.get(pb.isac_mode[i], "#e6e6e6")
            ax_m.axvspan(S(edges[i]), S(edges[i + 1]), color=c, lw=0)
    ax_m.set_yticks([])
    ax_m.set_ylabel("Effective\nmode", rotation=0, ha="right", va="center", labelpad=2)
    ax_m.legend([Patch(fc="#e6e6e6", ec="k", lw=0.3), Patch(fc="#ff8c00"), Patch(fc="#ffd700")],
                ["normal", "doppler\ndetected", "recovering"], loc="center left",
                bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=5.5, handlelength=1)
    plt.setp(ax_m.get_xticklabels(), visible=False)

    # ---- (d) bitrate + throughput ----
    if len(pb.server_ms):
        ax_b.step(S(pb.server_ms), pb.playing_bps / 1e3, where="post", color="#1f4e9c", lw=0.9,
                  label="Played bitrate")
    if snap.net is not None:
        ax_b.plot(S(snap.net.server_ms), snap.net.bps / 1e3, color="#d65f00", lw=0.7, marker=".",
                  ms=2, label="Measured throughput")
    ax_b.set_ylabel("Rate (kbit/s)")
    ax_b.set_yscale("symlog", linthresh=200)
    ax_b.grid(alpha=0.3, lw=0.4)
    ax_b.legend(loc="upper right", ncol=2, frameon=True, framealpha=0.85)
    ax_b.text(0.005, 0.95, "(e)", transform=ax_b.transAxes, va="top", fontweight="bold")
    plt.setp(ax_b.get_xticklabels(), visible=False)

    # ---- (e) buffer stacked by representation ----
    b = snap.buffer
    if b is not None and np.isfinite(b.server_ms).any():
        order = np.argsort(b.server_ms)
        x = S(b.server_ms[order])
        layers = [b.by_rank[order][:, i] for i in range(b.by_rank.shape[1])]
        colors = plt.cm.viridis(np.linspace(0.0, 0.95, len(layers)))[::-1]   # rank 0 (highest) = bright
        labels = [f"{bw / 1e3:.0f}" for bw in b.rep_bandwidth_bps]
        ax_u.stackplot(x, *layers, colors=colors, labels=labels, lw=0)
        ax_u.legend(title="Rep. (kbit/s)", title_fontsize=5.5, ncol=1, loc="center left",
                    bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=5, handlelength=1)
    ax_u.set_ylabel("Buffer (s)")
    ax_u.set_xlabel("Time since first spectrogram column (s, server time)")
    ax_u.grid(alpha=0.3, lw=0.4)
    ax_u.text(0.005, 0.95, "(f)", transform=ax_u.transAxes, va="top", fontweight="bold")

    # playback stalls (content time frozen while not user-paused): red shading in (e) and (f)
    stalls = find_stalls(snap)
    for st in stalls:
        a0 = S(st["t_ms"]); a1 = a0 + st["dur_s"]
        for ax in (ax_b, ax_u):
            ax.axvspan(a0, a1, color="#d62728", alpha=0.22, lw=0, zorder=0)
    if stalls:
        h, l = ax_b.get_legend_handles_labels()
        ax_b.legend(h + [Patch(fc="#d62728", alpha=0.35)], l + ["Playback stall"], loc="upper right", ncol=3,
                    frameon=True, framealpha=0.85)

    ax_s.set_xlim(x_lo, x_hi)

    out = a.out or os.path.splitext(a.snapshot)[0] + "_fig"
    fig.savefig(out + ".pdf")
    fig.savefig(out + ".png", dpi=300)
    off = snap.clock_offset_ms
    print(f"wrote {out}.pdf / .png   (spectrogram+interface from: {src}; "
          f"browser->server clock offset {off:+.2f} ms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
