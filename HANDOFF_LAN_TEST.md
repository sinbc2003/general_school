# HANDOFF: 수성고 B 서버 유선 outbound 실측 (트리거: "랜선 꽂음")

> 2026-06-11 세션 인계. 사용자가 **"랜선 꽂음"**이라고 말하면 이 문서대로 즉시 실행.
> 질문하지 말고 바로 Step 0부터 진행할 것.

## 배경 (이 세션에서 한 일)

- B 서버(main-server, Ubuntu 24.04, `ssh susung@100.92.66.61` Tailscale, NOPASSWD sudo)를 수성고로 이동 중.
- **netplan 수정 완료** (`/etc/netplan/50-cloud-init.yaml`, 백업: `.bak-pre-susung`):
  - 와이파이에 `susung_5g` 추가 (기존: 집 U+Net66E0, 폰 핫스팟 "병철의 S24 Ultra")
  - 유선 enp1s0: route-metric 100 → **700** + `use-dns: false` → 랜선 꽂아도 outbound(터널·Tailscale)는 와이파이(metric 600) 유지, 유선은 교내 LAN 서빙 전용
- 검증 완료: 적용 후 와이파이 재연결(현재 폰 핫스팟), 5개 서비스 active, pubedu.com HTTP 200.
- **미해결 질문**: 학교 유선망(192.168.0.0/24)의 outbound 차단이 진짜 전면 차단인지. 기록(2026-05-28, A 노트북 실측)엔 "ping·DNS·HTTPS 차단"이라 돼 있으나 사용자 기억으론 Tailscale 위주 테스트였고, **Cloudflare 터널 포트는 테스트한 적 없음**.
- **핵심 발견**: cloudflared 터널은 443이 아니라 **TCP/UDP 7844**로 edge에 연결함. 업체에 "443만" 요청하면 터널 안 붙음. 터널 작동 요건 = **DNS(53) + 7844** (QUIC 실패 시 TCP 7844 http2 fallback 자동이므로 TCP 7844만 열려도 OK).

## 목표

B가 학교 유선에 꽂힌 상태에서, 유선 단독으로 ICMP / DNS / TCP443 / TCP7844 가 되는지 실측 →
결과에 따라 (a) 유선 outbound 전환 또는 (b) 망 업체 요청문 확정.

## Step 0 — 사전 확인 (와이파이 경유, 안전)

```bash
ssh susung@100.92.66.61 'ip -br addr; ip route show default'
```
- `enp1s0`에 192.168.0.x IP가 있는지 확인 (랜선 + DHCP 정상). 없으면 사용자에게 "랜선/DHCP 확인" 요청하고 중단.
- `wlo1`이 susung_5g(또는 핫스팟)로 살아있는지 확인 — 이게 우리 SSH 통로.
- 참고로 cloudflared의 실제 edge 연결도 한번 확인: `sudo ss -tunp | grep cloudflared | grep -v "127.0.0.1:80"` (현재 어떤 포트로 나가는지 기록).

## Step 1 — 테스트 스크립트 배치

와이파이를 잠깐 내려야 유선 단독 측정이 되므로 **반드시 systemd-run으로 detach** (SSH 끊겨도 진행 + trap으로 와이파이 자동 복구).

```bash
ssh susung@100.92.66.61 'cat > /home/susung/gs-lan-test.sh <<"SCRIPT"
#!/usr/bin/env bash
# 수성고 유선 outbound 실측 — 와이파이 잠시 내리고 유선 단독 테스트, 끝나면 자동 복구
set -u
LOG=/home/susung/lan-test.log
exec >"$LOG" 2>&1
echo "=== gs-lan-test $(date) ==="
WIRED=enp1s0; WIFI=wlo1

restore() { ip link set "$WIFI" up 2>/dev/null; netplan apply 2>/dev/null; echo "[restore] wifi up + netplan apply done"; }
trap restore EXIT

ip -br addr
WIP=$(ip -4 -br addr show "$WIRED" | awk "{print \$3}")
echo "wired addr: ${WIP:-none}"
if [ -z "${WIP:-}" ]; then echo "ABORT: wired has no IPv4 — wifi 안 내리고 중단"; trap - EXIT; exit 1; fi

echo "--- wifi down (유선 단독) ---"
ip link set "$WIFI" down
sleep 3
ip route show default

t() { L="$1"; shift; echo "## $L"; if timeout 12 "$@"; then echo "RESULT[$L]: OK"; else echo "RESULT[$L]: FAIL($?)"; fi; }

t "ICMP_8.8.8.8"        ping -c 2 -W 3 8.8.8.8
t "DNS_system"          getent hosts www.google.com
t "DNS_direct_8888"     bash -c "command -v resolvectl >/dev/null && resolvectl query --legend=no google.com || nslookup google.com 8.8.8.8"
t "TCP443_IP직결"       curl -skm 8 -o /dev/null -w "http:%{http_code}\n" https://1.1.1.1
t "TCP443_DNS포함"      curl -skm 8 -o /dev/null -w "http:%{http_code}\n" https://www.google.com
t "TCP7844_cf_region1"  bash -c "cat </dev/null >/dev/tcp/198.41.192.167/7844"
t "TCP7844_cf_region2"  bash -c "cat </dev/null >/dev/tcp/198.41.200.113/7844"

echo "=== done $(date) ==="
SCRIPT
chmod +x /home/susung/gs-lan-test.sh && echo STAGED'
```

## Step 2 — 실행 (detach) → 90초 대기 → 결과 회수

```bash
ssh susung@100.92.66.61 'sudo systemd-run --unit=gs-lan-test bash /home/susung/gs-lan-test.sh && echo STARTED'
# 와이파이가 내려가므로 이 직후 SSH 잠시 불통 — 정상.
sleep 90
ssh -o ConnectTimeout=15 susung@100.92.66.61 'cat /home/susung/lan-test.log; echo ---; systemctl is-active cloudflared; tailscale status --peers=false | head -1'
```

- 90초 후에도 SSH 안 붙으면: 30초 간격 재시도. 그래도 안 되면 사용자에게 "B에서 폰 핫스팟 켜달라" 요청 (netplan에 등록돼 있어 자동 복구됨). 최후: D 경유 `ssh -J user@100.80.133.117 susung@<B유선IP>` (D가 켜져 있을 때만).

## Step 3 — 결과 해석 & 액션

| 결과 | 의미 | 액션 |
|---|---|---|
| TCP7844 OK + DNS OK | 유선으로 터널 가능 | netplan에서 enp1s0 metric 700→100, `use-dns: false` 제거 → `netplan apply`(detach) → cloudflared 유선 재연결 확인 + pubedu.com 200 확인. 와이파이는 백업으로 유지 |
| TCP7844 OK + DNS FAIL | 터널이 도메인 해석을 못 함 | 현 상태(와이파이 outbound) 유지. 업체에 **DNS(53)만** 요청 |
| TCP7844 FAIL | 기록대로 차단 | 현 상태 유지. 아래 업체 요청문 전달 |
| 전부 FAIL + 443도 FAIL | 전면 차단 확정 | 동일 — 요청문 전달. git pull/AI API도 유선 불가이므로 443 포함 필수 |

어느 경우든 마지막에: 사용자에게 결과 + 액션 보고. 유선 전환했으면 `iperf`까지는 불필요, pubedu.com 응답속도 체감 비교만 언급.

## 망 업체 요청문 (7844 보정판 — 차단 확정 시 전달)

> 안녕하세요, 교내 수업용 학습 플랫폼 서버(리눅스 1대)를 교무실 유선망에 운영하려고 합니다. 현재 유선망에서 외부 인터넷이 차단되어 있는데, **아래 단말 1대만 외부 인터넷(아웃바운드) 허용**을 요청드립니다.
>
> - 단말: 리눅스 서버 노트북 1대 (수업·과제 플랫폼)
> - **MAC 주소: 8c:b0:e9:20:99:81** (유선 랜카드)
> - 필요한 것(아웃바운드만): **TCP/UDP 7844** (Cloudflare Tunnel), **TCP 443**(HTTPS), **UDP/TCP 53**(DNS)
> - **외부에서 들어오는 포트 개방(인바운드)은 일절 필요 없습니다** — 외부 접속은 Cloudflare 터널(아웃바운드 연결)로만 처리합니다
> - 가능하면 이 단말에 고정 IP(DHCP 예약) 1개도 부탁드립니다 (교내 PC에서 접속 주소 고정용)

## 같은 날 함께 확인 (테스트 후 여유 있으면)

1. wlo1이 susung_5g에 자동 연결됐는지 (`sudo wpa_cli -i wlo1 status | grep ssid`) — 폰 핫스팟은 꺼두라고 안내 (둘 다 보이면 신호 센 쪽이 잡힘, netplan엔 SSID 우선순위 옵션 없음)
2. gs-autoip 로그: `journalctl -u gs-autoip -n 5` — LAN IP 갱신 확인 (GS_PUBLIC_URL=https://pubedu.com 설정돼 있어 도메인은 안 덮임)
3. 교내 유선 PC에서 `http://<B유선IP>` 접속
4. 외부(폰 LTE)에서 pubedu.com 접속

## 네트워크 사실관계 (참조)

- 학교 유선 192.168.0.0/24: outbound 차단(2026-05-28 기록, 본 테스트로 재검증 대상). 내부 라우터 10.111.197.104.
- 학교 와이파이 susung_5g: outbound OK, **client isolation** (와이파이→유선 차단. B는 양쪽에 직접 물리므로 무관).
- D 점프호스트(100.80.133.117): 평소 꺼져 있을 수 있음.
- B 접근 경로 우선순위: Tailscale(와이파이 경유) → 폰 핫스팟 켜기 → D 경유 유선 SSH.
- netplan 롤백: `/etc/netplan/50-cloud-init.yaml.bak-pre-susung`
