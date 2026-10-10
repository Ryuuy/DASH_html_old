DASH_update_20261009  (overwrite into DASH_html_old-main, same relative paths)

Superset of DASH_update_20261003: the page / dash-js files are UNCHANGED since 20261003
(included again so one overwrite gets you a consistent state). New / changed:

  analysis/session_tools.py     + load_ntg_csv(), markers in load_isac_log()
  analysis/isac_overview.py     NEW: Doppler waterfall + ch0/ch1 power + ridge + NTG-2501 in one figure
  snapshots_FORMAT.md           + section 12-14 (format v3, NTG CSV columns, how to read)
  ntg2501_power_logger/ntg2501_http_logger.py   + rates / PHY rate / path loss / unix_time / markers

The Ubuntu side (isac_bridge.py, isac_session_log.py, isac_overview.py in RealtimeISAC/) is changed
in the sdr_workspace repo; nothing to do on this machine for it. No change needed in isac_server.
Run:  python3 analysis/isac_overview.py "<isac_logs>/isac_<stamp>_p*.npz" --ntg <isac_logs>/ntg_<stamp>.csv

--- 20261009 (later) NTG-2501 three charts added to the page ---
  server7.js                  polls Master 192.168.1.201 @5Hz (NTG_POLL_MS/NTG_MASTER_IP/NTG_ENABLE=0), GET /api/ntg?since=,
                              saves ntg2501_power_logger/logs/ntg_server7_<stamp>.csv
  dash-js/fplot_Ntg.js (NEW)  graph8 wireless rate / graph9 Rx+Tx level+CNR (downlink 201->101) / graph10 in/out rate
  dashtest_2sDASH_1080p-public-access.html, dash-js/snapshotExport.js (snapshot gets "ntg" field)

--- 20261009 (c) fix: NTG charts jumping + USRP IQ energy chart ---
  dash-js/fplot_Ntg.js   poll de-dup (root cause: overlapping /api/ntg requests duplicated/reordered samples), 120 s sliding window
                         (?ntgwin=sec, 0=all), fixed/ratchet y-axes, red bands for link-down, 1 s avg on rates; NEW graph11
  dashtest_2sDASH_1080p-public-access.html  + graph11 canvas (reference/sensing channel dBFS)
