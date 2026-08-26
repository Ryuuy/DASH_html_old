# Claude Task Prompt — NTG-2501 SNMP / Web Monitor Real-Time Power Logger

## Goal

I am using **two JRC NTG-2501 25 GHz wireless units** in a real experiment.

- **Master IP:** `192.168.0.201`
- **Slave IP:** `192.168.0.101`
- Default Web admin password is believed to be: `admin1234`
- I can access each unit's Web Management / Main Monitor when I am in the lab.
- The **Slave web page does NOT show the Master's values**, and vice versa. Do **not** assume one unit exposes both sides.
- I specifically want to continuously record:
  1. **Slave-side transmit power / transmit level [dBm]**
  2. **Master-side receive power / receive level [dBm]**
  3. Time

The final purpose is to use these data in an academic paper, synchronized as well as reasonably possible with my other experiment logs.

I am currently at home and cannot access the `192.168.0.x` devices right now. I will run your instructions later on a **Windows experiment PC** connected to the NTG-2501 network.

---

# What I need you to do

Please act as an implementation engineer.

Do **not** merely explain SNMP conceptually. Give me a concrete procedure and code that I can run when I return to the lab.

There are two phases:

1. **Discovery phase** — determine whether SNMP exposes the desired values and identify the exact OIDs.
2. **Logging phase** — once OIDs are known, continuously sample both units and automatically save the values to a CSV file while I physically leave the PC and walk through the mmWave link.

I am the only person doing the experiment, so the logger must run unattended after I start it.

---

# Important constraints

## Device topology

Treat the two NTG-2501 units separately:

```text
Slave:  192.168.0.101
    |
    | 25 GHz wireless link
    |
Master: 192.168.0.201
```

The value I want from the Slave is:

```text
Slave transmit power / transmit level [dBm]
```

The value I want from the Master is:

```text
Master received power / received level [dBm]
```

Do not assume the Master can provide the Slave value through SNMP unless experiment output proves it.

Do not assume the Slave can provide the Master value.

---

# Phase 1 — SNMP discovery

First give me exact commands for Windows.

Assume I may not yet have `snmpget` / `snmpwalk` installed.

Please tell me:

- the simplest reliable Windows package/tool to install;
- how to confirm `snmpget` and `snmpwalk` are available;
- the exact PowerShell/CMD commands I should run.

Test **both devices independently**.

Start with standard SNMP system OIDs such as:

```text
1.3.6.1.2.1.1.1.0   sysDescr
1.3.6.1.2.1.1.2.0   sysObjectID
1.3.6.1.2.1.1.3.0   sysUpTime
```

Try likely default SNMPv2 communities, especially:

```text
public
public2
public3
```

Do not guess that one definitely works. Give a compact sequence that lets me test them.

Example target structure:

```powershell
snmpget -v2c -c public -On 192.168.0.201 1.3.6.1.2.1.1.1.0
snmpget -v2c -c public -On 192.168.0.101 1.3.6.1.2.1.1.1.0
```

Then inspect enterprise/private MIB space:

```text
1.3.6.1.4.1
```

I want commands that automatically save the complete output to files such as:

```text
master_private_oid.txt
slave_private_oid.txt
```

Prefer commands that both display and save the result when convenient.

---

# How to identify the correct OIDs

I do not know the exact OIDs for:

```text
Slave Tx power
Master Rx power
```

Design a practical method to identify them experimentally.

For example:

1. Run a private-tree `snmpwalk` on Slave and Master.
2. Save baseline output.
3. Cause a noticeable propagation change / blockage.
4. Run another walk.
5. Compare changed OIDs.
6. Cross-check candidate values against the numbers visibly displayed on each unit's Main Monitor.

Please account for possible internal numeric scaling such as:

```text
-54      -> -54 dBm
-540     -> -54.0 dBm
540      -> -54.0 dBm with a signed/scaled convention
```

Do not silently assume units/scaling.

If MIB symbolic names are unavailable, numeric OIDs are completely acceptable.

If possible, produce a small PowerShell or Python helper script that compares two `snmpwalk` dumps and highlights values that changed.

---

# Phase 2 — Real-time logger

Once the OIDs have been identified, produce a robust **Python logger for Windows**.

It should query:

```text
Slave 192.168.0.101 -> TX_OID
Master 192.168.0.201 -> RX_OID
```

and continuously save:

```csv
timestamp,elapsed_s,slave_tx_dbm,master_rx_dbm,slave_query_ms,master_query_ms,valid
```

A simpler schema is acceptable if you have a better technical design, but it must include at minimum:

```text
absolute timestamp
elapsed time
Slave Tx dBm
Master Rx dBm
```

Use:

- an absolute wall-clock timestamp, preferably ISO 8601 with milliseconds;
- `time.perf_counter()` or equivalent monotonic timing for elapsed time.

The CSV must be flushed continuously so that data are not lost if I stop the experiment with `Ctrl+C`.

The logger should:

- automatically create a filename containing date/time;
- print a compact live status to the terminal;
- continue running while I walk away from the PC;
- stop cleanly on `Ctrl+C`;
- preserve already recorded data;
- record or clearly report SNMP timeout/errors rather than silently dropping them.

---

# Timing / sampling requirements

I do **not** know the NTG-2501's internal measurement-update rate.

I want to test polling intervals down to approximately:

```text
0.10 s
0.05 s
0.02 s
0.01 s
```

Do not assume that 0.01 s polling means the radio measurement itself updates at 100 Hz.

Please distinguish:

1. **host polling rate**
2. **SNMP round-trip time**
3. **actual device value update rate**

The logger or a separate test program should help estimate the actual update cadence by detecting when the returned value changes.

I am willing to try `PERIOD = 0.01` s experimentally, but the program should not overload or crash just because the device cannot respond that fast.

Please use sensible timeout/error handling.

---

# Synchronization between Slave and Master

Because TX and RX come from **different physical devices**, timing matters.

Please think carefully about this.

I would prefer the two SNMP requests to be issued as close together as possible.

Possible approaches include:

- two concurrent requests using threads / futures;
- asynchronous subprocesses;
- an SNMP Python library capable of parallel requests.

Please choose a practical Windows-friendly solution.

Record enough timing information that I can estimate inter-device query skew.

For example, internally capture:

```text
cycle_start
slave_request_start
slave_response_time
master_request_start
master_response_time
```

You do not necessarily need all of these in the final CSV, but design the logger so the sampling timing is scientifically defensible.

Do not claim the two devices are exactly synchronized unless they truly are.

---

# Strong preference: avoid Selenium

My Main Monitor web page visibly shows these numeric values.

However, I would prefer this priority:

```text
1. SNMP
2. Direct HTTP/CGI endpoint used by the Main Monitor
3. HTML parsing
4. Selenium/browser automation only as a last resort
```

If SNMP does **not** expose the required fields, give me a fallback procedure using Chrome/Edge DevTools:

```text
F12
-> Network
-> log in
-> open Main Monitor
-> identify repeated status request
-> inspect response
-> Copy as cURL
```

Explain exactly what I should send back to you from DevTools.

The Web UI may require login/authentication using something like:

```text
admin
admin1234
```

but do not invent endpoint names such as `/login.cgi` unless observed from actual traffic.

If the page periodically refreshes through iframe/HTML rather than XHR/fetch, account for that possibility.

---

# Deliverables I want from you now

Please give me the following in one response:

## A. Lab checklist

A short numbered list of exactly what I should do when I arrive at the lab.

## B. SNMP discovery commands

Windows commands for both:

```text
192.168.0.101
192.168.0.201
```

including saving results to files.

## C. OID-comparison helper

A small script/tool for comparing before/after SNMP dumps.

## D. Final Python logger template

Use placeholders such as:

```python
SLAVE_TX_OID = "TO_BE_DISCOVERED"
MASTER_RX_OID = "TO_BE_DISCOVERED"
```

Do not fabricate actual NTG-2501 OIDs.

The code should otherwise be runnable.

## E. Sampling-rate test

Give me a concrete method/script to determine whether the NTG values really update at 100 Hz, 50 Hz, 20 Hz, 10 Hz, etc.

## F. Fallback if SNMP fails

Give exact DevTools steps to expose whatever HTTP/CGI request feeds Main Monitor.

---

# Scientific / paper-use considerations

This data will be used in a paper.

Please therefore avoid sloppy terminology.

Use:

```text
transmit power / transmit level [dBm]
received power / received level [dBm]
```

rather than calling dBm an "energy" value.

Also point out any important caveats that could affect interpretation, especially:

- ATPC / transmit-power-control behavior;
- measurement quantization;
- unknown internal averaging/filtering;
- device display refresh rate versus internal measurement rate;
- polling rate versus physical measurement rate;
- timing offset between the two independently queried devices.

I specifically want to compare physical blockage/sensing behavior with radio-link power behavior, so these details matter.

---

# Do not do these things

- Do not invent the exact NTG-2501 private OIDs.
- Do not assume Slave values are exposed through Master.
- Do not assume Master values are exposed through Slave.
- Do not assume Web refresh rate equals sensor update rate.
- Do not tell me merely to manually watch the web page.
- Do not require a second person to operate the experiment.
- Do not use Selenium unless SNMP and direct HTTP access both fail.
- Do not require me to keep interacting with the terminal while I am walking through the link.

The desired final workflow is:

```text
prepare experiment
-> start logger
-> logger automatically saves continuously
-> I walk through the mmWave link
-> return to PC
-> Ctrl+C
-> CSV is already complete
```
