//! Remote host monitoring collection and parsing helpers.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::manager::SessionManager;

/// Shell script compiled into the binary and executed remotely.
///
/// Collects CPU (aggregate + per-core), memory, disk, load, network throughput,
/// TCP state counts and top process metrics from a Linux host. All commands have fallbacks for
/// minimal environments (busybox, alpine). Output uses `NM_KEY=value` pairs
/// plus typed sections (`NM_*_BEGIN` … `NM_*_END`).
const MONITOR_SCRIPT: &str = r#"
CPUM=$(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs 2>/dev/null || echo N/A)
CPUC=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)
KER=$(uname -r 2>/dev/null || echo N/A)
OS=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s 2>/dev/null || echo Linux)
UP=$(uptime 2>/dev/null | sed 's/.*up //' | sed 's/,  *[0-9]* user.*//' | xargs 2>/dev/null || echo N/A)
DEFIF=$(awk '$2=="00000000"{print $1; exit}' /proc/net/route 2>/dev/null || echo '')
LOAD=$(cat /proc/loadavg 2>/dev/null || echo '0 0 0 0/0 0')
MEMINFO=$(awk '/MemTotal:/{t=$2*1024}/MemAvailable:/{a=$2*1024}/Buffers:/{b=$2*1024}/^Cached:/{c=$2*1024}/^Slab:/{s=$2*1024}END{printf "%d %d %d %d %d",t,a,b,c,s}' /proc/meminfo 2>/dev/null || echo '0 0 0 0 0')
SWP=$(free -b 2>/dev/null | awk 'NR==3{print $2,$3}' || echo '0 0')
PROCS=$(ps -e 2>/dev/null | tail -n +2 | wc -l | xargs 2>/dev/null || echo 0)
THREADS=$(ps -eL 2>/dev/null | tail -n +2 | wc -l | xargs 2>/dev/null || echo 0)
S1=$(awk 'NR==1{print $2+$3+$4+$5+$6+$7+$8,$5}' /proc/stat 2>/dev/null || echo '1 1')
sleep 0.3 2>/dev/null || true
S2=$(awk 'NR==1{print $2+$3+$4+$5+$6+$7+$8,$5}' /proc/stat 2>/dev/null || echo '2 2')
CPU=$(echo "$S1 $S2" | awk '{dt=$3-$1;di=$4-$2;if(dt>0)printf "%.1f",(1-di/dt)*100;else print "0"}')
echo "NM_CPUM=$CPUM"
echo "NM_CPUC=$CPUC"
echo "NM_KER=$KER"
echo "NM_OS=$OS"
echo "NM_UP=$UP"
echo "NM_DEFIF=$DEFIF"
echo "NM_LOAD=$LOAD"
echo "NM_MEMINFO=$MEMINFO"
echo "NM_SWP=$SWP"
echo "NM_CPU=$CPU"
echo "NM_PROCS=$PROCS"
echo "NM_THREADS=$THREADS"
echo "NM_TCP=$(awk 'BEGIN{for(i=0;i<2;i++){f=(i==0?"/proc/net/tcp":"/proc/net/tcp6");while((getline<f)>0){if($1!="sl"){st=$4;c[st]++}}close(f)}total=0;for(k in c)total+=c[k];printf "%d %d %d %d %d %d",total,c["01"]+0,c["06"]+0,c["0A"]+0,c["02"]+0,c["03"]+0}' 2>/dev/null || echo '0 0 0 0 0 0')"
echo NM_CPU_CORE_BEGIN
awk 'BEGIN{while((getline<"/proc/stat")>0){if($1~/^cpu[0-9]+$/){id=substr($1,4);idle=$5;total=0;for(i=2;i<=NF;i++)total+=$i;c1[id]=total;i1[id]=idle}}close("/proc/stat");system("sleep 0.3");while((getline<"/proc/stat")>0){if($1~/^cpu[0-9]+$/){id=substr($1,4);idle=$5;total=0;for(i=2;i<=NF;i++)total+=$i;dt=total-c1[id];di=idle-i1[id];if(dt>0)printf "%s %.1f\n",id,(1-di/dt)*100;else printf "%s 0\n",id}}' 2>/dev/null
echo NM_CPU_CORE_END
echo NM_NET_BEGIN
awk -v defif="$DEFIF" 'BEGIN{while((getline<"/proc/net/dev")>0){if($1~/:$/){iface=$1;sub(/:$/,"",iface);rx[iface]=$2;tx[iface]=$10}}close("/proc/net/dev");system("sleep 0.3");while((getline<"/proc/net/dev")>0){if($1~/:$/){iface=$1;sub(/:$/,"",iface);drx=$2-rx[iface];dtx=$10-tx[iface];tag=(iface==defif?"*":"");printf "%s%s %.0f %.0f\n",iface,tag,drx/0.3,dtx/0.3}}}' 2>/dev/null
echo NM_NET_END
echo NM_PROC_BEGIN
ps -eo pid=,user=,nlwp=,pcpu=,pmem=,rss=,comm= --sort=-pcpu --no-headers 2>/dev/null | head -12 | awk '{printf "%s|%s|%s|%s|%.1f|%.1f|%s\n",$1,$2,$3,$7,$4,$5,$6}'
echo NM_PROC_END
echo NM_PROC_MEM_BEGIN
ps -eo pid=,user=,nlwp=,pcpu=,pmem=,rss=,comm= --sort=-pmem --no-headers 2>/dev/null | head -12 | awk '{printf "%s|%s|%s|%s|%.1f|%.1f|%s\n",$1,$2,$3,$7,$4,$5,$6}'
echo NM_PROC_MEM_END
echo NM_DISK_BEGIN
df -B1 2>/dev/null | grep '^/' | awk '{print $1,$2,$3,$6}'
echo NM_DISK_END
echo NM_DISK_IO_BEGIN
awk 'BEGIN{
  while((getline<"/proc/diskstats")>0){
    n=$3; r[$3]=$4; rs[$3]=$6; w[$3]=$8; ws[$3]=$10; u[$3]=$13
  }
  close("/proc/diskstats")
  system("sleep 0.3")
  while((getline<"/proc/diskstats")>0){
    n=$3
    dr=$4-r[n]; drs=$6-rs[n]; dw=$8-w[n]; dws=$10-ws[n]; du=$13-u[n]
    iops=(dr+dw)/0.3; rbps=drs*512/0.3; wbps=dws*512/0.3; util=du/3
    printf "%s %.1f %.0f %.0f %.1f\n",n,iops,rbps,wbps,util
  }
}' 2>/dev/null
echo NM_DISK_IO_END
echo NM_INODE_BEGIN
df -Pi 2>/dev/null | grep '^/' | awk '{print $1,$2,$3,$6}'
echo NM_INODE_END
"#;

/// Collects system performance metrics from the remote host.
pub async fn collect_metrics(manager: &SessionManager, session_id: &str) -> Result<Value, String> {
    let result = manager
        .exec(session_id, MONITOR_SCRIPT.trim(), "monitor.metrics", false)
        .await?;
    let stdout = result["stdout"].as_str().unwrap_or("").to_string();
    let parsed = parse_monitor_output(&stdout);
    manager.monitor_cache_set(session_id, &parsed).await;
    Ok(parsed)
}

/// Inspects a single process on the remote host.
pub async fn inspect_process(
    manager: &SessionManager,
    session_id: &str,
    pid: i64,
) -> Result<Value, String> {
    let command = format!(
        "PID={pid}; \
if ! ps -p \"$PID\" >/dev/null 2>&1; then echo \"NM_ERROR=not_found\"; exit 0; fi; \
REALPID=\"$PID\"; \
echo \"NM_PID=$REALPID\"; \
NAME=$(ps -p \"$PID\" -o comm= 2>/dev/null | xargs 2>/dev/null || echo N/A); \
STATE=$(ps -p \"$PID\" -o state= 2>/dev/null | xargs 2>/dev/null || echo N/A); \
USER=$(ps -p \"$PID\" -o user= 2>/dev/null | xargs 2>/dev/null || echo N/A); \
PPID=$(ps -p \"$PID\" -o ppid= 2>/dev/null | xargs 2>/dev/null || echo 0); \
THREADS=$(ps -p \"$PID\" -o nlwp= 2>/dev/null | xargs 2>/dev/null || echo 0); \
START=$(ps -p \"$PID\" -o lstart= 2>/dev/null | xargs 2>/dev/null || echo N/A); \
CPU=$(ps -p \"$PID\" -o pcpu= 2>/dev/null | xargs 2>/dev/null || echo 0); \
MEM=$(ps -p \"$PID\" -o pmem= 2>/dev/null | xargs 2>/dev/null || echo 0); \
RSS=$(ps -p \"$PID\" -o rss= 2>/dev/null | xargs 2>/dev/null || echo 0); \
EXE=$(readlink -f /proc/$PID/exe 2>/dev/null || echo N/A); \
CWD=$(readlink -f /proc/$PID/cwd 2>/dev/null || echo N/A); \
FD=$(ls -1 /proc/$PID/fd 2>/dev/null | wc -l | xargs 2>/dev/null || echo 0); \
CMD=$(tr '\\0' ' ' </proc/$PID/cmdline 2>/dev/null | xargs 2>/dev/null || echo \"$NAME\"); \
CMD=$(printf \"%s\" \"$CMD\" | tr '\\n' ' ' | tr -s ' ' | cut -c1-300); \
NAME=$(printf \"%s\" \"$NAME\" | tr -s ' ' | cut -c1-80); \
echo \"NM_NAME=$NAME\"; \
echo \"NM_USER=$USER\"; \
echo \"NM_PPID=$PPID\"; \
echo \"NM_THREADS=$THREADS\"; \
echo \"NM_STATE=$STATE\"; \
echo \"NM_START=$START\"; \
echo \"NM_CPU=$CPU\"; \
echo \"NM_MEM=$MEM\"; \
echo \"NM_RSS=$RSS\"; \
echo \"NM_FD=$FD\"; \
echo \"NM_EXE=$EXE\"; \
echo \"NM_CWD=$CWD\"; \
echo \"NM_CMD=$CMD\""
    );
    let result = manager
        .exec(session_id, &command, "monitor.process.inspect", false)
        .await?;
    let stdout = result["stdout"].as_str().unwrap_or("").to_string();
    let detail = parse_process_detail_output(&stdout);
    if detail["error"].as_str().is_some() {
        return Err(format!("Process {pid} not found, exited, or access denied"));
    }
    Ok(detail)
}

/// Parses the raw stdout from `MONITOR_SCRIPT` into a structured JSON value.
fn parse_monitor_output(stdout: &str) -> Value {
    let mut kv: HashMap<String, String> = HashMap::new();
    let mut disks: Vec<Value> = Vec::new();
    let mut cpu_cores: Vec<Value> = Vec::new();
    let mut networks: Vec<Value> = Vec::new();
    let mut top_cpu_processes: Vec<Value> = Vec::new();
    let mut top_mem_processes: Vec<Value> = Vec::new();
    let mut inode_by_mountpoint: HashMap<String, Value> = HashMap::new();
    let mut disk_io_by_device: HashMap<String, Value> = HashMap::new();
    let mut section: Option<&str> = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        match line {
            "NM_DISK_BEGIN" => section = Some("disk"),
            "NM_DISK_END" => section = None,
            "NM_CPU_CORE_BEGIN" => section = Some("cpu_core"),
            "NM_CPU_CORE_END" => section = None,
            "NM_NET_BEGIN" => section = Some("net"),
            "NM_NET_END" => section = None,
            "NM_PROC_BEGIN" => section = Some("proc"),
            "NM_PROC_END" => section = None,
            "NM_PROC_MEM_BEGIN" => section = Some("proc_mem"),
            "NM_PROC_MEM_END" => section = None,
            "NM_DISK_IO_BEGIN" => section = Some("disk_io"),
            "NM_DISK_IO_END" => section = None,
            "NM_INODE_BEGIN" => section = Some("inode"),
            "NM_INODE_END" => section = None,
            _ => match section {
                Some("disk") => {
                    if let Some(disk) = parse_monitor_disk_line(line) {
                        disks.push(disk);
                    }
                }
                Some("cpu_core") => {
                    if let Some(core) = parse_monitor_cpu_core_line(line) {
                        cpu_cores.push(core);
                    }
                }
                Some("net") => {
                    if let Some(net) = parse_monitor_net_line(line) {
                        networks.push(net);
                    }
                }
                Some("proc") => {
                    if let Some(proc) = parse_monitor_proc_line(line) {
                        top_cpu_processes.push(proc);
                    }
                }
                Some("proc_mem") => {
                    if let Some(proc) = parse_monitor_proc_line(line) {
                        top_mem_processes.push(proc);
                    }
                }
                Some("disk_io") => {
                    if let Some(io) = parse_monitor_disk_io_line(line) {
                        if let Some(device) = io["device"].as_str() {
                            disk_io_by_device.insert(device.to_string(), io);
                        }
                    }
                }
                Some("inode") => {
                    if let Some(inode) = parse_monitor_inode_line(line) {
                        if let Some(mountpoint) = inode["mountpoint"].as_str() {
                            inode_by_mountpoint.insert(mountpoint.to_string(), inode);
                        }
                    }
                }
                None => {
                    if let Some(rest) = line.strip_prefix("NM_") {
                        if let Some(eq_pos) = rest.find('=') {
                            kv.insert(rest[..eq_pos].to_string(), rest[eq_pos + 1..].to_string());
                        }
                    }
                }
                _ => {}
            },
        }
    }

    cpu_cores.sort_by_key(|v| v["core"].as_i64().unwrap_or(0));
    enrich_disks_with_inode(&mut disks, &inode_by_mountpoint);
    enrich_disks_with_io(&mut disks, &disk_io_by_device);

    networks.sort_by(|a, b| {
        let a_primary = a["isPrimary"].as_bool().unwrap_or(false);
        let b_primary = b["isPrimary"].as_bool().unwrap_or(false);
        b_primary
            .cmp(&a_primary)
            .then_with(|| {
                let a_total = a["rxBps"].as_f64().unwrap_or(0.0) + a["txBps"].as_f64().unwrap_or(0.0);
                let b_total = b["rxBps"].as_f64().unwrap_or(0.0) + b["txBps"].as_f64().unwrap_or(0.0);
                b_total.partial_cmp(&a_total).unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let default_iface = kv.get("DEFIF").map(String::as_str).unwrap_or("").trim();
    let primary_iface = networks.iter().find(|n| n["isPrimary"].as_bool().unwrap_or(false));
    let total_source: Vec<&Value> = if let Some(primary) = primary_iface {
        vec![primary]
    } else {
        networks
            .iter()
            .filter(|n| !is_virtual_iface(n["name"].as_str().unwrap_or_default()))
            .collect()
    };
    let (network_rx_bps, network_tx_bps) = total_source.iter().fold((0.0_f64, 0.0_f64), |acc, n| {
        (
            acc.0 + n["rxBps"].as_f64().unwrap_or(0.0),
            acc.1 + n["txBps"].as_f64().unwrap_or(0.0),
        )
    });

    let load_parts = parse_f64_list(kv.get("LOAD").map(String::as_str).unwrap_or("0 0 0"));
    let mem_parts = parse_i64_list(kv.get("MEMINFO").map(String::as_str).unwrap_or("0 0 0 0 0"));
    let swp_parts = parse_i64_list(kv.get("SWP").map(String::as_str).unwrap_or("0 0"));
    let tcp_parts = parse_i64_list(kv.get("TCP").map(String::as_str).unwrap_or("0 0 0 0 0 0"));
    let mem_total = mem_parts.first().copied().unwrap_or(0);
    let mem_available = mem_parts.get(1).copied().unwrap_or(0);
    let mem_buffers = mem_parts.get(2).copied().unwrap_or(0);
    let mem_cached = mem_parts.get(3).copied().unwrap_or(0);
    let mem_slab = mem_parts.get(4).copied().unwrap_or(0);
    let mem_used = (mem_total - mem_available).max(0);

    json!({
        "cpuModel":       kv.get("CPUM").map(String::as_str).unwrap_or("N/A"),
        "cpuCores":       kv.get("CPUC").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(1),
        "cpuUsage":       kv.get("CPU").and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0),
        "cpuCoresDetail": cpu_cores,
        "kernelVersion":  kv.get("KER").map(String::as_str).unwrap_or("N/A"),
        "osName":         kv.get("OS").map(String::as_str).unwrap_or("N/A"),
        "uptime":         kv.get("UP").map(String::as_str).unwrap_or("N/A"),
        "loadAvg1":       load_parts.first().copied().unwrap_or(0.0),
        "loadAvg5":       load_parts.get(1).copied().unwrap_or(0.0),
        "loadAvg15":      load_parts.get(2).copied().unwrap_or(0.0),
        "processes":      kv.get("PROCS").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "threads":        kv.get("THREADS").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "memTotal":       mem_total,
        "memUsed":        mem_used,
        "memAvailable":   mem_available,
        "memBuffers":     mem_buffers,
        "memCached":      mem_cached,
        "memSlab":        mem_slab,
        "swapTotal":      swp_parts.first().copied().unwrap_or(0),
        "swapUsed":       swp_parts.get(1).copied().unwrap_or(0),
        "tcpConnections": {
            "total":       tcp_parts.first().copied().unwrap_or(0),
            "established": tcp_parts.get(1).copied().unwrap_or(0),
            "timeWait":    tcp_parts.get(2).copied().unwrap_or(0),
            "listen":      tcp_parts.get(3).copied().unwrap_or(0),
            "synSent":     tcp_parts.get(4).copied().unwrap_or(0),
            "synRecv":     tcp_parts.get(5).copied().unwrap_or(0),
        },
        "networkRxBps":   network_rx_bps,
        "networkTxBps":   network_tx_bps,
        "networkPrimaryIface": if default_iface.is_empty() { Value::Null } else { Value::from(default_iface) },
        "networkInterfaces": networks,
        "topProcesses":   top_cpu_processes,
        "topMemoryProcesses": top_mem_processes,
        "disks":          disks,
    })
}

/// Parses per-core CPU line: `0 12.5`.
fn parse_monitor_cpu_core_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let core: i64 = parts[0].parse().ok()?;
    let usage: f64 = parts[1].parse().ok()?;
    Some(json!({ "core": core, "usage": usage }))
}

/// Parses network interface line: `eth0 12345.0 67890.0` (rxBps txBps).
fn parse_monitor_net_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let name = parts[0];
    if name == "lo" {
        return None;
    }
    let rx_bps: f64 = parts[1].parse().ok()?;
    let tx_bps: f64 = parts[2].parse().ok()?;
    let is_primary = name.ends_with('*');
    let normalized = name.trim_end_matches('*');
    Some(json!({
        "name":   normalized,
        "rxBps":  rx_bps.max(0.0),
        "txBps":  tx_bps.max(0.0),
        "isPrimary": is_primary,
    }))
}

/// Parses process line: `pid|user|threads|name|cpuPct|memPct|rssKb`.
fn parse_monitor_proc_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() < 7 {
        return None;
    }
    let pid: i64 = parts[0].trim().parse().ok()?;
    let threads: i64 = parts[2].trim().parse().ok()?;
    let cpu_pct: f64 = parts[4].trim().parse().ok()?;
    let mem_pct: f64 = parts[5].trim().parse().ok()?;
    let rss_kb: i64 = parts[6].trim().parse().ok()?;
    Some(json!({
        "pid":    pid,
        "user":   parts[1].trim(),
        "threads": threads,
        "name":   parts[3].trim(),
        "cpuPct": cpu_pct,
        "memPct": mem_pct,
        "rss":    rss_kb.saturating_mul(1024),
    }))
}

/// Parses disk IO line: `device iops readBps writeBps utilPct`.
fn parse_monitor_disk_io_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    Some(json!({
        "device": parts[0],
        "iops": parts[1].parse::<f64>().ok()?,
        "readBps": parts[2].parse::<f64>().ok()?,
        "writeBps": parts[3].parse::<f64>().ok()?,
        "utilPct": parts[4].parse::<f64>().ok()?,
    }))
}

/// Parses inode line from `df -Pi`: `device total used mountpoint`.
fn parse_monitor_inode_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 4 {
        return None;
    }
    let total: i64 = parts[1].parse().ok()?;
    let used: i64 = parts[2].parse().ok()?;
    let avail = (total - used).max(0);
    Some(json!({
        "mountpoint": parts[3],
        "inodeTotal": total,
        "inodeUsed": used,
        "inodeAvail": avail,
    }))
}

/// Parses a single disk line from `df -B1` awk output: `device total used mountpoint`.
fn parse_monitor_disk_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 4 {
        return None;
    }
    let total: i64 = parts[1].parse().ok()?;
    let used: i64 = parts[2].parse().ok()?;
    Some(json!({
        "device":     parts[0],
        "total":      total,
        "used":       used,
        "avail":      (total - used).max(0),
        "mountpoint": parts[3],
        "inodeTotal": 0,
        "inodeUsed":  0,
        "inodeAvail": 0,
        "iops":       0.0,
        "readBps":    0.0,
        "writeBps":   0.0,
        "utilPct":    0.0,
    }))
}

fn enrich_disks_with_inode(disks: &mut [Value], inode_by_mountpoint: &HashMap<String, Value>) {
    for disk in disks.iter_mut() {
        let Some(mountpoint) = disk["mountpoint"].as_str() else {
            continue;
        };
        let Some(inode) = inode_by_mountpoint.get(mountpoint) else {
            continue;
        };
        if let Some(obj) = disk.as_object_mut() {
            obj.insert(
                "inodeTotal".to_string(),
                inode.get("inodeTotal").cloned().unwrap_or(Value::from(0)),
            );
            obj.insert(
                "inodeUsed".to_string(),
                inode.get("inodeUsed").cloned().unwrap_or(Value::from(0)),
            );
            obj.insert(
                "inodeAvail".to_string(),
                inode.get("inodeAvail").cloned().unwrap_or(Value::from(0)),
            );
        }
    }
}

fn enrich_disks_with_io(disks: &mut [Value], disk_io_by_device: &HashMap<String, Value>) {
    for disk in disks.iter_mut() {
        let Some(device) = disk["device"].as_str() else {
            continue;
        };
        let key = normalize_device_name(device);
        let Some(io) = disk_io_by_device.get(&key) else {
            continue;
        };
        if let Some(obj) = disk.as_object_mut() {
            obj.insert("iops".to_string(), io.get("iops").cloned().unwrap_or(Value::from(0.0)));
            obj.insert(
                "readBps".to_string(),
                io.get("readBps").cloned().unwrap_or(Value::from(0.0)),
            );
            obj.insert(
                "writeBps".to_string(),
                io.get("writeBps").cloned().unwrap_or(Value::from(0.0)),
            );
            obj.insert(
                "utilPct".to_string(),
                io.get("utilPct").cloned().unwrap_or(Value::from(0.0)),
            );
        }
    }
}

fn normalize_device_name(device: &str) -> String {
    device
        .strip_prefix("/dev/")
        .unwrap_or(device)
        .rsplit('/')
        .next()
        .unwrap_or(device)
        .to_string()
}

fn parse_f64_list(s: &str) -> Vec<f64> {
    s.split_whitespace()
        .map(|tok| tok.parse::<f64>().unwrap_or(0.0))
        .collect()
}

fn parse_i64_list(s: &str) -> Vec<i64> {
    s.split_whitespace()
        .map(|tok| tok.parse::<i64>().unwrap_or(0))
        .collect()
}

fn parse_process_detail_output(stdout: &str) -> Value {
    let mut kv: HashMap<String, String> = HashMap::new();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some(rest) = line.strip_prefix("NM_") {
            if let Some(eq_pos) = rest.find('=') {
                kv.insert(rest[..eq_pos].to_string(), rest[eq_pos + 1..].to_string());
            }
        }
    }
    json!({
        "error": kv.get("ERROR").cloned(),
        "pid": kv.get("PID").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "name": kv.get("NAME").cloned().unwrap_or_else(|| "N/A".to_string()),
        "user": kv.get("USER").cloned().unwrap_or_else(|| "N/A".to_string()),
        "ppid": kv.get("PPID").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "threads": kv.get("THREADS").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "state": kv.get("STATE").cloned().unwrap_or_else(|| "N/A".to_string()),
        "startTime": kv.get("START").cloned().unwrap_or_else(|| "N/A".to_string()),
        "cpuPct": kv.get("CPU").and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0),
        "memPct": kv.get("MEM").and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0),
        "rss": kv.get("RSS").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0).saturating_mul(1024),
        "fdCount": kv.get("FD").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
        "exe": kv.get("EXE").cloned().unwrap_or_else(|| "N/A".to_string()),
        "cwd": kv.get("CWD").cloned().unwrap_or_else(|| "N/A".to_string()),
        "cmdline": kv.get("CMD").cloned().unwrap_or_else(|| "N/A".to_string()),
    })
}

fn is_virtual_iface(name: &str) -> bool {
    let prefixes = [
        "lo", "docker", "veth", "br-", "virbr", "cni", "flannel", "zt", "tailscale", "tun", "tap",
    ];
    prefixes.iter().any(|prefix| name.starts_with(prefix))
}
